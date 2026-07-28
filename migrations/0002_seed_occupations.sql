INSERT OR REPLACE INTO occupations
  (code, title, description, provider, version, source_uri, aliases_json, competencies_json)
VALUES
(
  '15-1255.00',
  'Web and Digital Interface Designers',
  'Design digital interfaces and websites with attention to usability, aesthetics, and functional behavior.',
  'O*NET',
  '30.3',
  'https://www.onetonline.org/link/summary/15-1255.00',
  '["Web Designer","Product Designer","UI Designer","Digital Interface Designer"]',
  '[
    {"kind":"task","label":"Design, build, or maintain websites and digital interfaces","importance":95,"sourceUri":"https://www.onetonline.org/link/summary/15-1255.00"},
    {"kind":"knowledge","label":"Design","importance":90,"sourceUri":"https://www.onetonline.org/link/summary/15-1255.00"},
    {"kind":"knowledge","label":"Computers and electronics","importance":84,"sourceUri":"https://www.onetonline.org/link/summary/15-1255.00"},
    {"kind":"skill","label":"Programming","importance":77,"sourceUri":"https://www.onetonline.org/link/summary/15-1255.00"},
    {"kind":"skill","label":"Critical thinking","importance":75,"sourceUri":"https://www.onetonline.org/link/summary/15-1255.00"},
    {"kind":"technology","label":"Web platform and interface design tools","importance":82,"sourceUri":"https://www.onetonline.org/link/summary/15-1255.00"}
  ]'
),
(
  '15-1252.00',
  'Software Developers',
  'Research, design, and develop computer and network software or specialized utility programs.',
  'O*NET',
  '30.3',
  'https://www.onetonline.org/link/summary/15-1252.00',
  '["Software Engineer","Application Developer","Product Engineer"]',
  '[
    {"kind":"task","label":"Analyze information to determine software requirements","importance":94,"sourceUri":"https://www.onetonline.org/link/summary/15-1252.00"},
    {"kind":"knowledge","label":"Computers and electronics","importance":96,"sourceUri":"https://www.onetonline.org/link/summary/15-1252.00"},
    {"kind":"skill","label":"Programming","importance":92,"sourceUri":"https://www.onetonline.org/link/summary/15-1252.00"},
    {"kind":"skill","label":"Systems analysis","importance":84,"sourceUri":"https://www.onetonline.org/link/summary/15-1252.00"}
  ]'
),
(
  '15-1212.00',
  'Information Security Analysts',
  'Plan, implement, upgrade, or monitor security measures for information and systems.',
  'O*NET',
  '30.3',
  'https://www.onetonline.org/link/summary/15-1212.00',
  '["Security Analyst","Cybersecurity Analyst","Security Engineer"]',
  '[
    {"kind":"task","label":"Monitor security measures and investigate breaches","importance":95,"sourceUri":"https://www.onetonline.org/link/summary/15-1212.00"},
    {"kind":"knowledge","label":"Computers and electronics","importance":94,"sourceUri":"https://www.onetonline.org/link/summary/15-1212.00"},
    {"kind":"knowledge","label":"Public safety and security","importance":88,"sourceUri":"https://www.onetonline.org/link/summary/15-1212.00"},
    {"kind":"skill","label":"Complex problem solving","importance":85,"sourceUri":"https://www.onetonline.org/link/summary/15-1212.00"}
  ]'
),
(
  '15-2051.00',
  'Data Scientists',
  'Develop and implement methods to transform raw data into useful information.',
  'O*NET',
  '30.3',
  'https://www.onetonline.org/link/summary/15-2051.00',
  '["Machine Learning Scientist","Applied Scientist","Data Analyst"]',
  '[
    {"kind":"task","label":"Analyze large data sets to identify patterns and trends","importance":95,"sourceUri":"https://www.onetonline.org/link/summary/15-2051.00"},
    {"kind":"knowledge","label":"Mathematics","importance":94,"sourceUri":"https://www.onetonline.org/link/summary/15-2051.00"},
    {"kind":"skill","label":"Programming","importance":88,"sourceUri":"https://www.onetonline.org/link/summary/15-2051.00"},
    {"kind":"skill","label":"Judgment and decision making","importance":81,"sourceUri":"https://www.onetonline.org/link/summary/15-2051.00"}
  ]'
),
(
  '11-2021.00',
  'Marketing Managers',
  'Plan and direct marketing policies and programs and identify potential markets.',
  'O*NET',
  '30.3',
  'https://www.onetonline.org/link/summary/11-2021.00',
  '["Growth Lead","Brand Manager","Marketing Strategist"]',
  '[
    {"kind":"task","label":"Formulate and coordinate marketing activities and policies","importance":94,"sourceUri":"https://www.onetonline.org/link/summary/11-2021.00"},
    {"kind":"knowledge","label":"Sales and marketing","importance":97,"sourceUri":"https://www.onetonline.org/link/summary/11-2021.00"},
    {"kind":"skill","label":"Persuasion","importance":86,"sourceUri":"https://www.onetonline.org/link/summary/11-2021.00"},
    {"kind":"skill","label":"Critical thinking","importance":82,"sourceUri":"https://www.onetonline.org/link/summary/11-2021.00"}
  ]'
),
(
  '27-3042.00',
  'Technical Writers',
  'Write technical materials such as equipment manuals, appendices, or operating instructions.',
  'O*NET',
  '30.3',
  'https://www.onetonline.org/link/summary/27-3042.00',
  '["Documentation Engineer","Developer Educator","Technical Communicator"]',
  '[
    {"kind":"task","label":"Organize technical material according to standards of clarity and style","importance":95,"sourceUri":"https://www.onetonline.org/link/summary/27-3042.00"},
    {"kind":"knowledge","label":"English language","importance":96,"sourceUri":"https://www.onetonline.org/link/summary/27-3042.00"},
    {"kind":"skill","label":"Writing","importance":96,"sourceUri":"https://www.onetonline.org/link/summary/27-3042.00"},
    {"kind":"skill","label":"Active learning","importance":82,"sourceUri":"https://www.onetonline.org/link/summary/27-3042.00"}
  ]'
);

INSERT INTO occupations_fts (rowid, code, title, description, aliases)
SELECT rowid, code, title, description, aliases_json FROM occupations;

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('occupation_dataset', 'O*NET 30.3 starter catalog', datetime('now'));
