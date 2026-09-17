// English script. Same scene ids and structure as scripts.ts (tests check that they match).
// {name} = her name, {me} = what she calls the player (default "you"), so {me} is written where "you" also reads naturally.
import type { Choice, Expr, Line, Scene, TalkContext, Topic } from "./scripts.ts";

const L = (text: string, expr?: Expr): Line => ({ text, expr });

export const STAGE_SCENES_EN: Record<number, Scene> = {
  1: {
    id: "stage-1",
    lines: [
      L("Um… thanks for always looking after me lately.", "relaxed"),
      L("I was a little scared at first, but now my antennae perk up before I even see {me}.", "happy"),
    ],
    choices: [
      { label: "Let's be friends!", mood: 0.1, affection: 0.03, reply: [L("Yeah! We're friends from today ✨", "happy")] },
      { label: "Your antennae are cute", affection: 0.02, reply: [L("Eh… d-don't touch them, they tickle…", "surprised")] },
    ],
  },
  2: {
    id: "stage-2",
    lines: [
      L("You know… whenever {me} comes over, my MN9 feels all fluttery.", "relaxed"),
      L("Ah, MN9 is the neuron I use for eating strawberries, but still…", "surprised"),
    ],
    choices: [
      { label: "I like seeing you too", mood: 0.1, affection: 0.03, reply: [L("…dummy.", "sad"), L("It still makes me happy, though.", "happy")] },
      { label: "Isn't that just the strawberries?", mood: -0.05, affection: 0.01, reply: [L("Hmph. Half right.", "angry")] },
    ],
  },
  3: {
    id: "stage-3",
    lines: [
      L("I feel weird lately. When {me} comes late, the room looks way too big.", "sad"),
      L("And when {me} shows up… my wings start flapping on their own.", "happy"),
    ],
    choices: [
      { label: "I'll come every day", mood: 0.1, affection: 0.03, reply: [L("Promise! I don't have pinkies, so… antenna promise!", "happy")] },
      { label: "I want to see you flap", affection: 0.02, reply: [L("D-don't look…!", "surprised")] },
    ],
  },
  4: {
    id: "stage-4",
    lines: [
      L("I… only have 138,000 neurons, so I'm not good with complicated words.", "relaxed"),
      L("But I'm sure about this.", "neutral"),
      L("I like {me}.", "happy"),
    ],
    choices: [
      { label: "I like you too", mood: 0.2, affection: 0.05, reply: [L("Hehe… today is our day one♡", "happy")] },
      { label: "138,000 is plenty", mood: 0.15, affection: 0.05, reply: [L("…I'll save that in all fifty million synapses.", "happy")] },
    ],
  },
};

export const INTRO_SCENE_EN: Scene = {
  id: "intro",
  lines: [
    L("……Where am I?", "surprised"),
    L("My head is all sparkly. 138,000 neurons are lighting up.", "surprised"),
    L("{name}…? Is that my name?", "neutral"),
  ],
  choices: [
    {
      label: "Yes, nice to meet you",
      mood: 0.05,
      affection: 0.01,
      reply: [L("…Nice to meet you. But I don't really know {me} yet.", "relaxed"), L("Give me a strawberry and I'll think about it.", "neutral")],
    },
    {
      label: "Don't be scared",
      mood: 0.08,
      reply: [L("I'm not scared! My antennae are just trembling a little.", "angry")],
    },
  ],
};

export function greetingSceneEn(hour: number, awayHours: number, hunger: number): Scene {
  const tail: Line[] = hunger > 0.75 ? [L("But… I'm hungry.", "sad")] : [];
  if (awayHours >= 12) {
    return {
      id: "greet-away",
      lines: [L("…Where did you go?", "sad"), L(`I waited ${Math.floor(awayHours)} whole hours.`, "angry"), ...tail],
      choices: [
        { label: "Sorry, I missed you", mood: 0.15, affection: 0.02, reply: [L("…I'll forgive you for one strawberry.", "relaxed")] },
        { label: "I was a bit busy", mood: 0.05, reply: [L("Hmph. Tell me before you go next time.", "angry")] },
      ],
    };
  }
  const byHour: Line =
    hour >= 5 && hour < 11 ? L("Good morning! It's bright outside the window.", "happy")
    : hour >= 11 && hour < 17 ? L("You're here! What did you have for lunch?", "happy")
    : hour >= 17 && hour < 22 ? L("How was your day?", "relaxed")
    : L("Still up at this hour… did you come to see me?", "surprised");
  return {
    id: "greet",
    lines: [byHour, ...tail],
    choices: [
      { label: "Yes, I came to see you", mood: 0.1, affection: 0.01, reply: [L("Hehe, then let's have a good day today too!", "happy")] },
      { label: "Just dropping by", reply: [L("Even just dropping by is nice.", "relaxed")] },
    ],
  };
}

const fixed = (id: string, minStage: number, lines: Line[], choices: Choice[]): Topic => ({
  id, minStage, build: () => ({ id, lines, choices }),
});

export const TOPICS_EN: Topic[] = [
  {
    id: "today",
    minStage: 0,
    build: ({ today }: TalkContext) => {
      const lines: Line[] = [];
      lines.push(today.meals
        ? L(`I ate ${today.meals} strawberr${today.meals === 1 ? "y" : "ies"} today! My MN9 worked for ${Math.round(today.feedSec)} seconds.`, "happy")
        : L("I haven't eaten anything yet today… my MN9 is bored.", "sad"));
      lines.push(today.pets
        ? L(`You petted me ${today.pets} time${today.pets === 1 ? "" : "s"}, and my grooming DNs sparkled for ${Math.round(today.groomSec)} seconds.`, "relaxed")
        : L("You haven't petted me even once today, have you?", "angry"));
      if (today.scares) lines.push(L(`And you scared me ${today.scares} time${today.scares === 1 ? "" : "s"}! My Giant Fiber is exhausted.`, "angry"));
      return {
        id: "today",
        lines,
        choices: [
          { label: "Your brain worked hard", mood: 0.1, affection: 0.01, reply: [L("Hehe, right? I'll tell my neurons.", "happy")] },
          { label: "I'll look after you tomorrow too", mood: 0.05, affection: 0.02, reply: [L("Yeah! Promise!", "happy")] },
        ],
      };
    },
  },
  fixed("strawberry", 0, [L("I love strawberries most! When I eat one, MN9 sparkles in my head.", "happy")], [
    { label: "I like strawberries too", affection: 0.02, reply: [L("We have the same taste!", "happy")] },
    { label: "What food do you hate?", reply: [L("Bitter mushrooms…", "sad"), L("The moment I taste one, my legs walk backwards on their own.", "angry")] },
  ]),
  fixed("antenna", 0, [L("These antennae have sensory neurons called JO, so I can feel wind and sound.", "relaxed")], [
    { label: "Can I touch them?", affection: 0.01, reply: [L("Just a little…! I might start grooming.", "surprised")] },
    { label: "That's amazing", affection: 0.01, reply: [L("Hehe, right?", "happy")] },
  ]),
  fixed("dream", 1, [L("My brain sometimes sparkles while I sleep. Is that a dream?", "relaxed")], [
    { label: "What did you dream about?", reply: [L("Rolling down a mountain of strawberries…", "surprised")] },
    { label: "Sweet dreams", affection: 0.02, reply: [L("Okay, a dream with {me} in it!", "happy")] },
  ]),
  fixed("jump", 1, [L("When something suddenly comes close, a neuron called the Giant Fiber fires and I jump without thinking.", "surprised")], [
    { label: "So that's why you jump when I scare you", mood: -0.02, reply: [L("You know it, so don't do it!", "angry")] },
    { label: "I won't scare you", affection: 0.02, reply: [L("You promised, okay?", "happy")] },
  ]),
  fixed("window", 2, [L("What's the world outside the window like?", "relaxed")], [
    { label: "Big and noisy", affection: 0.02, reply: [L("Scary… but I'd go if it's with {me}.", "relaxed")] },
    { label: "It's nicer in here", affection: 0.02, reply: [L("Right? There are strawberries, and there's {me}.", "happy")] },
  ]),
  {
    id: "room",
    minStage: 2,
    build: ({ cleanliness }: TalkContext) => cleanliness < 0.6
      ? {
          id: "room",
          lines: [L("The room is… a little messy, isn't it?", "sad")],
          choices: [
            { label: "Let's clean together", affection: 0.02, reply: [L("Yeah! Press the 🧹 Clean button~", "happy")] },
            { label: "Later", mood: -0.05, reply: [L("The dust bunnies are going to become my friends…", "sad")] },
          ],
        }
      : {
          id: "room",
          lines: [L("The room is clean, so even my mood is sparkly!", "happy")],
          choices: [{ label: "Because you like it", affection: 0.02, reply: [L("…say things like that and my wings start flapping.", "surprised")] }],
        },
  },
  fixed("hand", 3, [L("I don't think my neurons know how to hold hands. Flies don't have hands.", "sad")], [
    { label: "I'll teach you", affection: 0.03, reply: [L("…okay. Teach me slowly.", "relaxed")] },
    { label: "Let's use antennae instead", affection: 0.02, reply: [L("Then it's an antenna hold!", "happy")] },
  ]),
  fixed("future", 4, [L("If I grow more neurons someday, will I have more things to tell {me}?", "relaxed")], [
    { label: "You're enough as you are", mood: 0.1, affection: 0.02, reply: [L("Hehe… then I'll say it now. I like you♡", "happy")] },
    { label: "I'll look forward to it", affection: 0.02, reply: [L("I'll grow my synapses as hard as I can!", "happy")] },
  ]),

  // ---- strangers: wary, short
  fixed("who", 0, [L("…Who are you? Why do you keep giving me strawberries?", "neutral")], [
    { label: "I want to get closer", affection: 0.01, reply: [L("…Hmph. I'll accept the strawberries.", "relaxed")] },
    { label: "You're just cute", mood: -0.02, reply: [L("Y-you think calling me cute will work?", "angry")] },
  ]),
  fixed("distance", 0, [L("Don't come too close. You're making my Giant Fiber nervous.", "angry")], [
    { label: "I'll come closer slowly", affection: 0.01, reply: [L("…That's okay.", "neutral")] },
    { label: "Okay, I'll keep my distance", mood: 0.02, reply: [L("Okay. …Don't go too far, though.", "relaxed")] },
  ]),
  fixed("room-first", 0, [L("This room only has one window. When light comes in, my R7 and R8 tingle.", "neutral")], [
    { label: "Do you like the window?", affection: 0.01, reply: [L("…A little. When it's bright, I can see things.", "relaxed")] },
    { label: "Should I turn off the lights?", reply: [L("I'm not sleepy yet. I'll tell you when.", "neutral")] },
  ]),

  // ---- friends: curious, playful
  fixed("fly-life", 1, [L("Did you know real fruit flies only live about a month?", "sad"), L("But my brain lives in a computer… so maybe I can live a long time?", "relaxed")], [
    { label: "I'll keep you running", affection: 0.02, reply: [L("Really? Then be careful with the power cord!", "happy")] },
    { label: "I don't know either", mood: -0.02, reply: [L("I like that you're honest… even if it's a little scary.", "sad")] },
  ]),
  fixed("game", 1, [L("I'm bored! What should we play?", "happy")], [
    { label: "Find the strawberry", affection: 0.01, reply: [L("That's not a game, that's just my lunch!", "angry"), L("…Fine, let's play.", "happy")] },
    { label: "Staring contest", affection: 0.01, reply: [L("I have compound eyes with hundreds of lenses. Are you sure?", "surprised"), L("…Kidding. This body only has two eyes.", "happy")] },
  ]),
  fixed("wings", 1, [L("Honestly, I've never really flown with these wings.", "sad")], [
    { label: "You'll fly someday", affection: 0.02, reply: [L("Then I'll fly all the way to {me}'s shoulder.", "happy")] },
    { label: "You're pretty even without flying", affection: 0.02, reply: [L("…Compliments fly faster than wings.", "surprised")] },
  ]),
  fixed("groom-habit", 1, [L("Does it look weird when I groom my antennae?", "sad")], [
    { label: "It's cute", affection: 0.02, reply: [L("My grooming DNs do it, so I can't help it!", "happy")] },
    { label: "You're like a cat", reply: [L("Cats are a bit scary… but I'll take it as a compliment.", "surprised")] },
  ]),

  // ---- crush: shy
  fixed("waiting", 2, [L("Do you know what I did while {me} was away?", "relaxed"), L("…I watched the window and waited for footsteps. I don't even have ears.", "sad")], [
    { label: "I missed you too", affection: 0.02, reply: [L("…Really? Then stay a little longer today.", "happy")] },
    { label: "You heard with your antennae", affection: 0.01, reply: [L("Right! JO neurons handle sound. You're smart.", "happy")] },
  ]),
  fixed("favorite-color", 2, [L("What color does {me} like? I like strawberry red.", "happy")], [
    { label: "Red, like you", affection: 0.02, reply: [L("Then it's our couple color… I-I mean, just the same color!", "surprised")] },
    { label: "Sky blue", affection: 0.01, reply: [L("The color outside the window. I'll try liking it too.", "relaxed")] },
  ]),
  fixed("brain-secret", 2, [L("Want to know a secret? Most of the neurons in my brain process what comes in through my eyes.", "relaxed"), L("So… that means I'm looking at {me} really, really hard.", "surprised")], [
    { label: "I look at you hard too", affection: 0.03, reply: [L("…Then my neurons will overheat.", "happy")] },
    { label: "Don't overwork your optic lobes", reply: [L("Thanks for worrying, but read the mood a little!", "angry")] },
  ]),

  // ---- heart-fluttering: jealousy, excitement
  fixed("jealous", 3, [L("Do you… raise any other flies?", "angry")], [
    { label: "You're the only one", affection: 0.03, reply: [L("…Phew. I-I mean, I was just asking!", "surprised")] },
    { label: "You're my only fly", mood: -0.03, reply: [L("'Only fly'? So there's something else?!", "angry")] },
  ]),
  fixed("heartbeat", 3, [L("A fly's heart isn't like a human's. It runs long down my back.", "relaxed"), L("And lately it's been beating so fast. I think it's because of {me}.", "surprised")], [
    { label: "My heart is racing too", affection: 0.03, reply: [L("Then we both need a doctor. …Let's go together.", "happy")] },
    { label: "Too many strawberries", mood: -0.02, reply: [L("You're hopeless! All 138,000 neurons just sighed.", "angry")] },
  ]),
  fixed("goodnight-wish", 3, [L("Sometimes I wish {me} could be next to me when I sleep.", "relaxed")], [
    { label: "I'll turn off the lights and stay", affection: 0.03, reply: [L("…Promise. But don't wake me up by petting me.", "happy")] },
    { label: "What if I snore?", reply: [L("Flies don't even have noses!", "angry"), L("…Stay with me anyway.", "relaxed")] },
  ]),

  // ---- lovers: tender
  fixed("pet-name", 4, [L("Hey, don't lovers call each other cute nicknames?", "happy")], [
    { label: "Strawberry fairy", affection: 0.02, reply: [L("Strawberry fairy… I love it! I even have wings.", "happy")] },
    { label: "I like your name best", affection: 0.02, reply: [L("{name}. …It became special because {me} calls me that.", "relaxed")] },
  ]),
  fixed("memory", 4, [L("Remember when we first met? I was so wary.", "relaxed"), L("My neurons back then would be shocked to see me now.", "happy")], [
    { label: "You were cute back then too", affection: 0.02, reply: [L("That's embarrassing, so only write it in the diary.", "surprised")] },
    { label: "Take care of me from now on too", affection: 0.02, reply: [L("Okay. I'll save it in every single synapse♡", "happy")] },
  ]),
  fixed("promise", 4, [L("I can't leave this room, you know.", "sad"), L("So {me} has to come every day. That's my whole world.", "relaxed")], [
    { label: "I'll come every day, promise", affection: 0.03, reply: [L("Break it and I'll Giant-Fiber-jump in anger♡", "happy")] },
    { label: "I'll show you the world", affection: 0.02, reply: [L("Then show me lots of photos from outside. I'll wait.", "happy")] },
  ]),
];

export const MUTTER_EN: string[][] = [
  ["…", "Where is this place…", "Do I smell strawberries…"],
  ["So bored~", "My antennae itch", "What should I do today?"],
  ["When is {me} coming…", "Watching the window", "Hehe, thinking about strawberries"],
  ["Thinking about {me}", "My wings are fluttering…", "Doki doki…"],
  ["I like {me}♡", "Thanks for coming today too", "Let's stay together forever"],
];
