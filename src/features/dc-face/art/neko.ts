import type { FaceProfile } from "../core/dc-face-types.ts";

export const NEKO_DEFAULT: readonly string[] = [
  "   /\\_/\\   ",
  "  ( o.o )  ",
  "   > ^ <   ",
];

export const NEKO_PROFILE: FaceProfile = {
  id: "neko",
  name: "neko (Gatito)",
  defaultFace: NEKO_DEFAULT,
  frames: {
    dormido: [
      [
        "   /\\_/\\   ",
        "  ( -.- ) z",
        "   > ^ <   ",
      ],
      [
        "   /\\_/\\   ",
        "  ( -.- ) zZ",
        "   > ^ <   ",
      ],
    ],
    pensando: [
      [
        "   /\\_/\\   ",
        "  ( O.o ) ?",
        "   > ^ <   ",
      ],
      [
        "   /\\_/\\   ",
        "  ( o.O ) ?",
        "   > ^ <   ",
      ],
    ],
    escribiendo: [
      [
        "   /\\_/\\   ",
        "  ( ^.^ )/ ",
        "   > ^ <   ",
      ],
      [
        "   /\\_/\\   ",
        "  \\( ^.^ ) ",
        "   > ^ <   ",
      ],
    ],
    trabajando: [
      [
        "   /\\_/\\   ",
        "  ( ◉.◉ )  ",
        "   > ^ <   ",
      ],
      [
        "   /\\_/\\   ",
        "  ( ♥.♥ )  ",
        "   > ^ <   ",
      ],
    ],
    compactando: [
      [
        "   /\\_/\\   ",
        "  ( >.< ) ~",
        "   > ^ <   ",
      ],
    ],
    feliz: [
      [
        "   /\\_/\\   ",
        "  ( ★.★ ) !",
        "   > ^ <   ",
      ],
    ],
  },
};
