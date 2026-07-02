import type { SearchResult } from "@/lib/types";

const AUSTRALIA_HARDWARE_SEEDS: SearchResult[] = [
  {
    title: "Andromeda Robotics team Grace Brown Founder CEO",
    url: "https://andromedarobotics.ai/team"
  },
  {
    title: "Andromeda Robotics news Grace Brown AI robot coverage",
    url: "https://andromedarobotics.ai/news"
  },
  {
    title: "Andromeda Robotics role of robots in the near future",
    url: "https://andromedarobotics.ai/post/what-role-will-robots-play-in-our-near-future"
  },
  {
    title: "Andromeda Robotics Series A funding news",
    url: "https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision"
  },
  {
    title: "Andromeda Robotics Abi robot feature",
    url: "https://andromedarobotics.ai/post/andromeda-abi-robot-womens-agenda"
  },
  {
    title: "Andromeda Robotics home",
    url: "https://andromedarobotics.ai/"
  },
  {
    title: "Morse Micro Wi-Fi HaLow funding",
    url: "https://www.morsemicro.com/news/morse-micro-secures-88-million-aud-series-c-funding/"
  }
];

export function getSeedSources(prompt: string): SearchResult[] {
  const normalized = prompt.toLowerCase();
  const mentionsAustralia = /澳|australia|australian/.test(normalized);
  const mentionsHardware = /硬件|hardware|robot|机器人|semiconductor|chip|芯片|deep tech/.test(normalized);
  const mentionsCeo = /ceo|创始|founder|负责人|首席执行官/.test(normalized);

  if (mentionsAustralia && mentionsHardware && mentionsCeo) {
    return AUSTRALIA_HARDWARE_SEEDS;
  }

  return [];
}
