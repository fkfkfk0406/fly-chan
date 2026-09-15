"""FlyWire v783 커넥톰을 브라우저용 바이너리로 변환한다.

입력 (pipeline/raw/, fetch_data.py 로 준비)
  Completeness_783.csv, Connectivity_783.parquet, neuron_annotations.tsv

출력 (public/data/, 모두 리틀엔디언)
  neurons_pos.f32     뉴런별 xyz, [-1, 1] 정규화
  neurons_class.u8    뉴런별 super_class 코드 (meta.json 의 classes 순서)
  csr_offsets.u32     pre 뉴런별 시작 오프셋 (N+1)
  csr_targets.u32     post 뉴런 인덱스
  csr_weights.i16     시냅스 수 x 부호(흥분 +1 / 억제 -1)
  groups.json         입출력 뉴런 그룹 인덱스
  meta.json           개수, 클래스 이름, LIF 파라미터
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT.parent / "public" / "data"

# Shiu et al. example.ipynb 의 당 감지 GRN (v783 에 남아 있는 것만 사용됨)
SUGAR_IDS = [
    720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345,
    720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367,
    720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538,
    720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919,
    720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
    720575940611875570,
]
MN9_IDS = [720575940660219265]  # Shiu et al. 섭식 운동뉴런 MN9

# Shiu et al. figures.ipynb (Fig. 3·4) 의 물 감지 GRN (ppk28 계열). sugar 와 같은 반구.
# 모두 v783 에 존재: FlyWire 주석상 LB3 17개 + LB2d 1개 ("sugar/water" 로 뭉뚱그려져 있음).
# 출력 연결 코사인 유사도로 봐도 sugar 중심보다 water 중심에 가깝다.
WATER_IDS = [
    720575940612950568, 720575940631898285, 720575940606002609, 720575940612579053,
    720575940622902535, 720575940616177458, 720575940660292225, 720575940622486922,
    720575940613786774, 720575940629852866, 720575940625861168, 720575940613996959,
    720575940617857694, 720575940644965399, 720575940625203504, 720575940630553415,
    720575940635172191, 720575940634796536,
]
# Shiu et al. figures.ipynb 의 Ir94e GRN (저농도 소금·섭식 억제성). sugar 와 같은 반구.
# FlyWire 주석상 LB1e 11개(주석은 "bitter"!) + LB2a-b 4개 + LB2c 3개 ("low-salt").
IR94E_IDS = [
    720575940614211295, 720575940638218173, 720575940628832256, 720575940626016017,
    720575940621375231, 720575940612920386, 720575940614273292, 720575940628198503,
    720575940626241636, 720575940619387814, 720575940624604560, 720575940615274425,
    720575940610683315, 720575940627265265, 720575940624079544, 720575940629211607,
    720575940615089369, 720575940631082124,
]

# Shiu et al. model.py default_params
LIF_PARAMS = {
    "v0": -52.0, "vReset": -52.0, "vTh": -45.0,  # mV
    "tauM": 20.0, "tauSyn": 5.0, "tRef": 2.2, "tDelay": 1.8,  # ms
    "wSyn": 0.275,  # mV / 시냅스
    "fPoisson": 250,  # Poisson 입력 1회 = wSyn * fPoisson mV
}

# FlyWire 좌표 단위: x, y 4 nm / z 40 nm 복셀
VOXEL_NM = np.array([4.0, 4.0, 40.0])


def build_groups(ann: pd.DataFrame, index_of: dict) -> dict:
    ct = ann.cell_type.fillna("")
    sub = ann.cell_sub_class.fillna("")
    cls = ann.cell_class.fillna("")
    side = ann.side.fillna("")

    def pick(mask) -> list[int]:
        ids = ann.loc[mask, "root_id"]
        return sorted(index_of[i] for i in ids if i in index_of)

    def pick_ids(ids) -> list[int]:
        return sorted(index_of[i] for i in ids if i in index_of)

    turn = ct.isin(["DNa01", "DNa02"])
    # 후각(ORN): 적응 없는 LIF 에서는 10 Hz 자극만으로도 약 10만 뉴런이 자극을 끊은 뒤에도
    # 계속 발화하는 폭주 상태에 빠진다 (scripts/persist.ts). 식초 계열 사구체만 실험용으로 내보낸다.
    food_orn = ct.isin(["ORN_DM1", "ORN_VA2", "ORN_DM4"])
    return {
        # 감각 입력
        "sugar": pick_ids(SUGAR_IDS),
        "bitter": pick(sub == "bitter"),
        "jo_touch": pick(sub == "grooming"),  # JO-F: 더듬이 접촉
        "looming": pick(ct == "LPLC2"),
        "light": pick(ct.isin(["R7", "R8"])),
        "odor_left": pick(food_orn & (side == "left")),
        "odor_right": pick(food_orn & (side == "right")),
        # --- 간식 후보 미각 그룹 (scripts/taste_probe.ts 로 반응 확인)
        # 물: Shiu et al. 물 GRN ID (신뢰도 높음)
        "water": pick_ids(WATER_IDS),
        # Ir94e: Shiu et al. Ir94e GRN ID (신뢰도 높음, 단 맛 자체는 저염/아미노산 등 논란)
        "ir94e": pick_ids(IR94E_IDS),
        # 저염: FlyWire 주석 cell_sub_class == "low-salt" 양쪽 (LB2a-b, LB2c, LB4a).
        # LB4a 는 수용체 대응이 확인되지 않음 (신뢰도 중간)
        "low_salt": pick(sub == "low-salt"),
        # 고염: LB2d 중 글루탐산성 GRN. 글루탐산성 ppk23/Ir7c 고염 GRN 과 형태·전달물질이 맞음 (신뢰도 낮음~중간)
        "high_salt": pick((ct == "LB2d") & (ann.top_nt == "glutamate")),
        # 맛 돌기(taste peg) GRN: 탄산(CO2)·지방산(Ir56d) 감지로 알려짐 (신뢰도 중간)
        "taste_peg": pick(ct.isin(["claw_tpGRN", "dorsal_tpGRN"])),
        # 인두 GRN: PhG1 ≈ Gr64e+ (당), PhG3·4 ≈ ppk28+ (물) 로 대응된다는 보고 (신뢰도 낮음~중간)
        "pharynx_sugar": pick(ct.isin(["PhG1a", "PhG1b", "PhG1c"])),
        "pharynx_water": pick(ct.isin(["PhG3", "PhG4"])),
        # 다리(VNC) 미각 상행 뉴런 SA_VTV: 감각 종류 불명 (탐색용)
        "leg_taste": pick((cls == "gustatory") & (sub == "SA_VTV_pro_meso_meta")),
        # 운동 출력
        "forward": pick(ct == "DNp09"),  # P9
        "backward": pick(ct == "MDN"),  # moonwalker
        "turn_left": pick(turn & (side == "left")),
        "turn_right": pick(turn & (side == "right")),
        "escape": pick(ct == "DNp01"),  # giant fiber
        "groom": pick(ct.isin(["DNg84", "DNg29", "DNg57"])),  # JO-F 자극에 선택적으로 반응 (scripts/probe.ts)
        "feed": pick_ids(MN9_IDS),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    comp = pd.read_csv(RAW / "Completeness_783.csv", index_col=0)
    root_ids = comp.index.to_numpy()
    n = len(root_ids)
    index_of = {rid: i for i, rid in enumerate(root_ids)}
    print(f"neurons      {n:,}")

    # --- 뉴런 좌표·클래스
    ann = pd.read_csv(RAW / "neuron_annotations.tsv", sep="\t", low_memory=False)
    ann = ann[ann.root_id.isin(index_of)].drop_duplicates("root_id")
    print(f"annotated    {len(ann):,} ({n - len(ann)} 누락 → 중심 좌표)")

    xyz = ann[["soma_x", "soma_y", "soma_z"]].to_numpy(float)
    fallback = ann[["pos_x", "pos_y", "pos_z"]].to_numpy(float)
    xyz = np.where(np.isnan(xyz), fallback, xyz) * VOXEL_NM

    pos = np.full((n, 3), np.nan)
    rows = ann.root_id.map(index_of).to_numpy()
    pos[rows] = xyz
    center = np.nanmean(pos, axis=0)
    pos = np.where(np.isnan(pos), center, pos) - center
    pos[:, 1] *= -1  # 이미지 y(아래) → three.js y(위)
    pos[:, 2] *= -1
    pos /= np.abs(pos).max()
    pos.astype("<f4").tofile(OUT / "neurons_pos.f32")

    classes = ["unknown"] + sorted(ann.super_class.dropna().unique().tolist())
    code = np.zeros(n, dtype=np.uint8)
    code[rows] = ann.super_class.fillna("unknown").map(classes.index).to_numpy()
    code.astype("u1").tofile(OUT / "neurons_class.u8")

    # --- 연결 행렬 → CSR
    con = pd.read_parquet(
        RAW / "Connectivity_783.parquet",
        columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"],
    )
    pre = con["Presynaptic_Index"].to_numpy(np.int64)
    post = con["Postsynaptic_Index"].to_numpy(np.int64)
    w = con["Excitatory x Connectivity"].to_numpy(np.int64)
    assert pre.max() < n and post.max() < n
    assert np.abs(w).max() <= np.iinfo(np.int16).max

    order = np.lexsort((post, pre))
    pre, post, w = pre[order], post[order], w[order]
    offsets = np.zeros(n + 1, dtype=np.uint32)
    np.cumsum(np.bincount(pre, minlength=n), out=offsets[1:])
    offsets.astype("<u4").tofile(OUT / "csr_offsets.u32")
    post.astype("<u4").tofile(OUT / "csr_targets.u32")
    w.astype("<i2").tofile(OUT / "csr_weights.i16")
    synapses = int(np.abs(w).sum())
    print(f"connections  {len(w):,}")
    print(f"synapses     {synapses:,}")

    # --- 입출력 그룹
    groups = build_groups(ann, index_of)
    print("groups")
    for name, idx in groups.items():
        print(f"  {name:<11} {len(idx):>5}")
        if not idx:
            raise SystemExit(f"그룹 {name} 이 비어 있음 — 주석 이름을 확인하세요")
    (OUT / "groups.json").write_text(json.dumps(groups))

    # 하강·운동 뉴런 이름표 (UI 표시와 분석 스크립트용)
    named = ann[ann.super_class.isin(["descending", "motor"])]
    labels = {int(index_of[r]): f"{t}_{s[:1].upper()}" for r, t, s in
              zip(named.root_id, named.cell_type.fillna("?"), named.side.fillna(""))}
    for i in groups["feed"]:
        labels[i] = "MN9"
    (OUT / "labels.json").write_text(json.dumps(labels))

    meta = {
        "neurons": n,
        "connections": int(len(w)),
        "synapses": synapses,
        "classes": classes,
        "lif": LIF_PARAMS,
        "source": "FlyWire v783 · Shiu et al. 2024 · Schlegel et al. 2024",
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
