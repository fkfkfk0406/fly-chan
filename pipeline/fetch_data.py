"""원본 데이터를 pipeline/raw/ 에 내려받는다.

- Shiu et al. 2024 (Nature) 공개 모델: FlyWire v783 뉴런 목록 + 연결 행렬
- Schlegel et al. 2024 (Nature) FlyWire 뉴런 주석: 좌표, super_class, cell_type
"""
import sys
from pathlib import Path
from urllib.request import urlretrieve

sys.stdout.reconfigure(encoding="utf-8")

RAW = Path(__file__).parent / "raw"
MODELS = Path(__file__).parent.parent / "public" / "models"

FILES = {
    # 캐릭터 모델: pixiv VRM 1.0 샘플 (VRM Public License 1.0, 누구나·상업·수정·재배포 허용)
    str(MODELS / "yumeka.vrm"):
        "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm",
    "Completeness_783.csv":
        "https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Completeness_783.csv",
    "Connectivity_783.parquet":
        "https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Connectivity_783.parquet",
    "neuron_annotations.tsv":
        "https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv",
}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        dest = RAW / name  # 절대 경로면 그대로
        name = dest.name
        if dest.exists():
            print(f"skip  {name} (이미 있음)")
            continue
        print(f"fetch {name} ...")
        urlretrieve(url, dest)
        print(f"      {dest.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
