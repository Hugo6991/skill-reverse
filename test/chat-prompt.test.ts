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
  it("checks all available context lanes instead of presenting a blank intake form", () => {
    const prompt = buildChatPrompt(report);

    expect(prompt).toContain("目前與先前的對話");
    expect(prompt).toContain("已保存的記憶與偏好");
    expect(prompt).toContain("專案檔案、程式碼與先前產出");
    expect(prompt).toContain("已使用或提過的 prompt、skill、plugin、agent 與工具結果");
    expect(prompt).toContain("已做過的決定、嘗試、反饋、失敗與修正");
    expect(prompt).not.toContain("[請填在這裡]");
  });

  it("requires an assumption marker next to every inferred part", () => {
    const prompt = buildChatPrompt(report);

    expect(prompt).toContain("假設：<具體假設>，如果不對請糾正");
    expect(prompt).toContain("不得只在文末集中列出假設");
  });

  it("puts a complete v1 before no more than three blocking questions", () => {
    const prompt = buildChatPrompt(report);
    const resultPosition = prompt.indexOf("1. 完整 v1 結果");
    const questionPosition = prompt.indexOf("4. 阻塞性問題（僅在需要時）");

    expect(resultPosition).toBeGreaterThan(-1);
    expect(questionPosition).toBeGreaterThan(resultPosition);
    expect(prompt).toContain("最多三個");
    expect(prompt).toContain("若沒有答案會改變產出方向的問題，省略整段");
    expect(prompt).not.toContain("v0");
    expect(prompt).not.toContain("哪些部分仍需要我的情境判斷");
  });

  it("keeps the extracted framework rules in the generated prompt", () => {
    const prompt = buildChatPrompt(report);

    expect(prompt).toContain("「先讀脈絡，再做判斷」");
    expect(prompt).toContain("1. 先從已有證據推斷目前目標");
    expect(prompt).toContain("2. 用合理假設完成第一版");
  });
});
