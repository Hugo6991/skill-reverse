import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "../src/chatPrompt";
import type { ReverseReport } from "../src/types";

const report: Pick<ReverseReport, "framework"> = {
  framework: {
    name: "先讀脈絡，再做判斷。",
    summary: "從已有資訊還原問題",
    useWhen: "已有對話或工作產出",
    avoidWhen: "完全沒有任何可用資訊",
    steps: [
      {
        title: "還原目標",
        instruction: "先從已有證據推斷目前目標。",
        failureType: "omission"
      },
      {
        title: "交付初稿",
        instruction: "用合理假設完成第一版。",
        failureType: "discipline"
      }
    ]
  }
};

describe("chat trial prompt", () => {
  it("uses available context instead of presenting a blank intake form", () => {
    const prompt = buildChatPrompt(report);

    expect(prompt).toContain("目前與先前的對話");
    expect(prompt).toContain("已保存的記憶與偏好");
    expect(prompt).toContain("已使用或提過的 prompt、skill、plugin、agent 與工具結果");
    expect(prompt).not.toContain("[請填在這裡]");
  });

  it("requires a preliminary result before any tightly limited follow-up", () => {
    const prompt = buildChatPrompt(report);
    const resultPosition = prompt.indexOf("先交付一版可用的初步結果");
    const questionPosition = prompt.indexOf("最多問一個影響最大的問題");

    expect(resultPosition).toBeGreaterThan(-1);
    expect(questionPosition).toBeGreaterThan(resultPosition);
    expect(prompt).toContain("預設先做出 v0");
  });

  it("keeps the extracted framework rules in the generated prompt", () => {
    const prompt = buildChatPrompt(report);

    expect(prompt).toContain("「先讀脈絡，再做判斷」");
    expect(prompt).toContain("1. 先從已有證據推斷目前目標");
    expect(prompt).toContain("2. 用合理假設完成第一版");
  });
});
