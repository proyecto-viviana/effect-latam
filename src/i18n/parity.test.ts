import { describe, expect, it } from "vitest";
import { ARTICLES, LABS } from "../learn/catalog";
import { articleContent } from "../learn/articles";
import { guideForLab } from "../learn/course";
import { FORUMS, forumText } from "../forums/registry";
import { EL_ACHIEVEMENTS } from "../achievements/catalog";
import { achievementText } from "../achievements/text";

describe("Portuguese content parity", () => {
  it("has a guide with the same shape for every lab", () => {
    for (const lab of LABS) {
      const es = guideForLab(lab.id, "es");
      const pt = guideForLab(lab.id, "pt");
      expect(pt.objectives).toHaveLength(es.objectives.length);
      expect(pt.exercise).toHaveLength(es.exercise.length);
      expect(pt.introduction).not.toBe(es.introduction);
      expect(pt.minutes).toBe(es.minutes);
      expect(pt.forum).toBe(es.forum);
    }
  });

  it("has an article with the same sections and code for every reading", () => {
    for (const meta of ARTICLES) {
      const es = articleContent(meta.id, "es");
      const pt = articleContent(meta.id, "pt");
      expect(pt.sections).toHaveLength(es.sections.length);
      es.sections.forEach((section, index) => {
        expect(pt.sections[index]!.paragraphs).toHaveLength(section.paragraphs.length);
        expect(Boolean(pt.sections[index]!.code)).toBe(Boolean(section.code));
      });
      expect(pt.lab).toBe(es.lab);
    }
  });

  it("translates every forum and achievement", () => {
    for (const forum of FORUMS) expect(forumText(forum, "pt").description).not.toBe("");
    for (const achievement of EL_ACHIEVEMENTS) {
      expect(achievementText(achievement, "pt").description).not.toBe(achievement.description);
    }
  });
});
