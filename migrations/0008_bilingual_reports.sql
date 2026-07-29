PRAGMA foreign_keys = ON;

ALTER TABLE reports ADD COLUMN content_schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE occupations ADD COLUMN localizations_json TEXT NOT NULL DEFAULT '{}';

UPDATE occupations
SET localizations_json = CASE code
  WHEN '15-1255.00' THEN '{"zh-TW":{"title":"網頁與數位介面設計師","description":"設計數位介面與網站，兼顧易用性、美感與功能行為","aliases":["網頁設計師","產品設計師","UI 設計師","數位介面設計師"],"competencyLabels":["設計、建立或維護網站與數位介面","設計","電腦與電子","程式設計","批判性思考","網頁平台與介面設計工具"]}}'
  WHEN '15-1252.00' THEN '{"zh-TW":{"title":"軟體開發人員","description":"研究、設計並開發電腦、網路軟體或專用工具程式","aliases":["軟體工程師","應用程式開發者","產品工程師"],"competencyLabels":["分析資訊以判斷軟體需求","電腦與電子","程式設計","系統分析"]}}'
  WHEN '15-1212.00' THEN '{"zh-TW":{"title":"資訊安全分析師","description":"規劃、實作、升級或監控資訊與系統的安全措施","aliases":["資安分析師","網路安全分析師","資安工程師"],"competencyLabels":["監控安全措施並調查資安事件","電腦與電子","公共安全與保全","複雜問題解決"]}}'
  WHEN '15-2051.00' THEN '{"zh-TW":{"title":"資料科學家","description":"開發並實作方法，將原始資料轉化為有用資訊","aliases":["機器學習科學家","應用科學家","資料分析師"],"competencyLabels":["分析大型資料集以找出模式與趨勢","數學","程式設計","判斷與決策"]}}'
  WHEN '11-2021.00' THEN '{"zh-TW":{"title":"行銷經理","description":"規劃並領導行銷政策與計畫，辨識潛在市場","aliases":["成長負責人","品牌經理","行銷策略師"],"competencyLabels":["制定並協調行銷活動與政策","銷售與行銷","說服","批判性思考"]}}'
  WHEN '27-3042.00' THEN '{"zh-TW":{"title":"技術寫作者","description":"撰寫操作手冊、附錄或操作指示等技術材料","aliases":["文件工程師","開發者教育者","技術溝通者"],"competencyLabels":["依清晰度與風格標準組織技術材料","英語","寫作","主動學習"]}}'
  ELSE '{}'
END;

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '8', datetime('now'));
