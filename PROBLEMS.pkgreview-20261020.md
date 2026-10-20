# PROBLEMS.pkgreview-20261020 — @juli-os/artifacts 逐文件 review & fix 台账

- 日期：2026-10-20；范围：本仓全部 10 个 TS 文件（/tmp/pkgreview-artifacts.txt），每文件一子 agent 保守修
- 纪律：只修 100% 不改行为项（已发包铁律：公开行为/导出签名/wire 格式/存储布局一律只报告）；test 断言/fixture 不动；零 git 写操作
- 基线快照 /tmp/pkgreview-baseline/artifacts/；批次报告 /tmp/pkgreview-reports/batch-0*.json
- 验证终态：npm run build + npm test 全绿（见总控汇总）

## 逐文件明细

### bin/juli-artifacts.ts

fixed=3 reported_only=3

- **P1** L38 [fixed] ls() 死代码（未用 ids Set+重复 DB 查询+void 压标记+说谎注释），删
- **P1** L30 [reported-only] demo() 传 ViewRole 值冒充 ArtifactRole——bin/ 不在 tsc include 内从未暴露的真类型错误（修=改存储 key 布局）
- **P2** L57 [fixed] verify() 多余 as 断言（判别联合已收窄），删
- **P2** L6 [fixed] 用法注释声明从不读取的 [id] 参数，改真
- **P2** L2 [reported-only] 自称 read-only CLI 但 open() 建目录建库跑迁移
- **P2** L59 [reported-only] 副作用三元作语句与全文 if/else 风格不一致

### src/index.ts

fixed=0 reported_only=1

- **P2** L36 [reported-only] JudgmentQuestion 出现在 ask 签名里但 facade 未 re-export（下游无法按名引用；词汇缺口非缺陷）

### src/platform/artifacts/ledger.ts

fixed=1 reported_only=8

- **P2** L176 [fixed] register 调用冗余展开（key/meta 显式覆盖与 ...row 同值），简化 this.register(row)
- **P1** L30 [reported-only] （跨文件）bin demo 的 ViewRole 冒充 ArtifactRole 在本文件 str() as ArtifactRole 处被静默盖章——tsc 直接复现 3 条 TS2322
- **P2** L33 [reported-only] 线索复核：ArtifactRole 已在公开导出面，消费方无需本包变更即可去 as never（但无运行时校验器导出）
- **P2** L136 [reported-only] register 取回走 list().find() 全量线性查（get(id) 行为等价直达，微重构不动）
- **P2** L308 [reported-only] envelope 预守卫与 parseEnvelope 内部判型重复
- **P2** L284 [reported-only] sweepCaseInbox readdir catch-all 静默空结果无日志（EACCES 与 ENOENT 无差别）
- **P2** L43 [reported-only] ViewRole 联合与 VIEW_ROLES 数组双份声明无编译期同步防护
- **P2** L366 [reported-only] 收编顺序 put→unlink→push：unlink 失败时 entries 漏报且下次同名成 seq+1 新版本
- **P2** L353 [reported-only] DeliverableDecl.summary 声明 string 说谎（过滤只校验 file，运行时可任意类型）

### src/platform/artifacts/store.ts

fixed=3 reported_only=2

- **P2** L5 [fixed] 死 import stat，删
- **P2** L124 [fixed] host 去scheme+去斜杠正则链三处逐字重复，提 hostOnly（SigV4 已知向量逐字节验证）
- **P2** L47 [fixed] async IIFE 包单个 unlink 冗余包装，直传 Promise
- **P2** L64 [reported-only] disk list 键切片用未 resolve 的 rootDir.length+1——rootDir 含冗余段时产出坏键（现调用方全传干净绝对路径）
- **P2** L69 [reported-only] disk list 裸 catch 吞一切错误返回 []（故障伪装成空仓）

### src/platform/shared/clock.ts

fixed=0 reported_only=2

- **P2** L1 [reported-only] 家族三仓副本（本仓份是下游消费的权威源）
- **P2** L17 [reported-only] randomIds 用 Math.random（账本主键非令牌+可注入端口，有意取舍）

### src/platform/shared/json.ts

fixed=0 reported_only=4

- **P1** L1 [reported-only] 整文件本仓死代码（家族同形+已发布 .d.ts 面禁删）
- **P2** L1 [reported-only] npm 包发布孤儿 .d.ts（无对应 .js，exports 不可达，tarball 死重）
- **P2** L1 [reported-only] json 家族：l0/l2/routing 逐字节同、ledger 裁剪版——生态事实源已收编 artifacts
- **P2** L29 [reported-only] truncate n=0 返回 '…'（同款边界）

### src/platform/shared/result.ts

fixed=0 reported_only=2

- **P2** L1 [reported-only] 整文件本仓死代码+头注释宣称与实际不符（家族同形禁删）
- **P2** L13 [reported-only] 家族副本行为漂移：agents '操作失败' vs 本仓/artifacts 'operation failed'

### test/regress.test.ts

fixed=0 reported_only=1

- **P2** L30 [reported-only] 通配断言被上行更严格断言蕴含（无害自文档化）

### test/smoke.test.ts

fixed=0 reported_only=3

- **P2** L20 [reported-only] decideRoute 实参 as never 断言禁用全部类型检查（字面量本可结构满足 Routing；fixture 禁动）
- **P2** L60 [reported-only] FbRecord 实参 as never 伪造部分记录（as FbRecord 更诚实；fixture 禁动）
- **P2** L27 [reported-only] test1/test2 routing fixture 骨架雷同仅值不同（per-test 隔离惯例）

### test/surface.test.ts

零发现。
