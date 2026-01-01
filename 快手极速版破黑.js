


// 引入依赖库：querystring用于参数解析，axios用于网络请求，socks-proxy-agent用于代理配置
const qs = require("querystring");
const axios = require("axios");
const querystring = require("querystring");
const { SocksProxyAgent } = require("socks-proxy-agent");
// ================================= 环境变量配置（可通过环境变量覆盖，均有默认值）=================================
// 执行任务列表：默认全量任务（food=饭补广告, food1=饭补广告1, food2=饭补广告2, fb=翻倍广告, ss=搜索广告, box=宝箱广告, look=看广告得金币）
process.env.Task = process.env.Task || "food,food1,food2,fb,ss,box,look";
// 开发模式开关：值为"1"或"true"时启用，用于调试输出
const isDevMode = process.env.DEV_MODE === "1" || process.env.DEV_MODE === "true";
// look任务冷却检测开关：值为"0"或"false"时禁用，默认启用（true）
const ENABLE_LOOK_COOLDOWN_CHECK = 0;// 提交奖励前延时（毫秒），默认800ms
const SUBMIT_BEFORE_DELAY = getEnvNumber("SUBMIT_BEFORE_DELAY", 500);
//所有任务观看等待时间
const GLOBAL_WATCH_SECONDS = getEnvNumber("GLOBAL_WATCH_SECONDS", 1);
/**
 * 工具函数：获取环境变量的数字值，无有效数值时返回默认值
 * @param {string} envKey - 环境变量名
 * @param {number} defaultValue - 默认值
 * @returns {number} 解析后的数字
 */
function getEnvNumber(envKey, defaultValue) {
  const value = parseInt(process.env[envKey], 10);
  return isNaN(value) ? defaultValue : value;
}
// 新增：等待时间控制环境变量（默认值兼容原有逻辑，可通过环境变量覆盖）
const SAME_TASK_DELAY_MIN = getEnvNumber("SAME_TASK_DELAY_MIN", 1); // 同一任务最小间隔（秒）
const SAME_TASK_DELAY_MAX = getEnvNumber("SAME_TASK_DELAY_MAX", 1); // 同一任务最大间隔（秒）
const TASK_BETWEEN_DELAY_MIN = getEnvNumber("TASK_BETWEEN_DELAY_MIN", 1); // 任务切换最小间隔（秒）
const TASK_BETWEEN_DELAY_MAX = getEnvNumber("TASK_BETWEEN_DELAY_MAX", 1); // 任务切换最大间隔（秒）
const INIT_TO_FORMAL_DELAY_MIN = getEnvNumber("INIT_TO_FORMAL_DELAY_MIN", 1); // 初始→追加广告最小间隔（秒）
const INIT_TO_FORMAL_DELAY_MAX = getEnvNumber("INIT_TO_FORMAL_DELAY_MAX", 1); // 初始→追加广告最大间隔（秒）

// 👇 新增以下4行（观看时间随机控制变量）
 const LOOK_WATCH_SECONDS_MIN = getEnvNumber("LOOK_WATCH_SECONDS_MIN", 1); // look任务最小观看时间（秒）
 const LOOK_WATCH_SECONDS_MAX = getEnvNumber("LOOK_WATCH_SECONDS_MAX", 3); // look任务最大观看时间（秒）
 const GLOBAL_WATCH_SECONDS_MIN = getEnvNumber("GLOBAL_WATCH_SECONDS_MIN", 1); // 其他任务最小观看时间（秒）
 const GLOBAL_WATCH_SECONDS_MAX = getEnvNumber("GLOBAL_WATCH_SECONDS_MAX", 1); // 其他任务最大观看时间（秒）

// 最低金币阈值
const KSLOW_REWARD_THRESHOLD = getEnvNumber("KSLOW_REWARD_THRESHOLD", 1);
// 执行轮数：所有账号需完成的任务轮次（默认1轮）
const KSROUNDS = getEnvNumber("KSROUNDS", 1);
// 金币上限：账号金币达到该值后停止任务（默认500000金币）
const KSCOIN_LIMIT = getEnvNumber("KSCOIN_LIMIT", 500000);
// 连续低奖励上限：连续低奖励次数达到该值停止任务（默认3次）
const KSLOW_REWARD_LIMIT = getEnvNumber("KSLOW_REWARD_LIMIT", 2);
// look任务单独配置：观看广告等待秒数（默认0秒，可通过环境变量调整）
//const LOOK_WATCH_SECONDS = getEnvNumber("LOOK_WATCH_SECONDS", 1);
// 最大并发账号数：同时执行任务的账号数量（默认888个）
const MAX_CONCURRENCY = getEnvNumber("MAX_CONCURRENCY", 888);
// 新增：任务执行模式（核心变量）
// 0 = 只跑初始广告，循环执行TASK_COUNTS次数
// 1 = 先跑1次初始广告，再跑追加广告（默认逻辑）
// 2 = 只跑追加广告
const TASK_EXEC_MODE = getEnvNumber("TASK_EXEC_MODE", 2);
// ================================= 任务配置与解析 =================================
/**
 * 获取要执行的任务列表：从环境变量Task解析，过滤无效任务
 * @returns {string[]} 有效任务key数组
 */
function getTasksToExecute() {
  const taskEnv = process.env.Task;
  if (!taskEnv) {
    console.log("未设置Task环境变量，将执行所有任务 (food, food1, food2, fb, ss, box, look)");
    return ["food", "box", "look", "food1", "food2", "fb", "ss"];
  }
  // 分割、去空格、转小写、过滤空值
  const tasks = taskEnv
    .split(",")
    .map((task) => task.trim().toLowerCase())
    .filter(Boolean);
  // 支持的有效任务key列表
  const validTasks = ["food", "box", "look", "food1", "food2"];
  const filteredTasks = tasks.filter((task) => validTasks.includes(task));
  
  if (filteredTasks.length === 0) {
    console.log("Task环境变量中没有有效任务，将执行默认任务 (food, food1, food2, fb, ss, box, look)");
    return ["food", "box", "look", "food1", "food2"];
  }
  console.log("从Task环境变量中解析到要执行的任务: " + filteredTasks.join(", "));
  return filteredTasks;
}
/**
 * 解析每轮每任务执行次数：从环境变量TASK_COUNTS解析，格式"food:20,box:10"
 * @returns {object} 任务-次数映射对象
 */
function parseTaskCounts() {
  // 默认每轮任务次数：所有任务默认99999次（足够多轮执行）
  const defaultCounts = {
    food: 99999,
    box: 99999,
    look: 99999,
    food1: 99999,
    food2: 99999,
     };
  const env = process.env.TASK_COUNTS;
  if (!env) {
    console.log("未配置 TASK_COUNTS，使用默认每轮次数:", JSON.stringify(defaultCounts));
    return defaultCounts;
  }
  const parts = env.split(",").map((p) => p.trim()).filter(Boolean);
  const result = { ...defaultCounts };
  for (const part of parts) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (!k) continue;
    const num = parseInt(v, 10);
    if (!isNaN(num)) {
      result[k] = num;
    } else {
      console.log(`TASK_COUNTS: 忽略非法值 ${part}`);
    }
  }
  console.log("解析到每轮任务次数:", JSON.stringify(result));
  return result;
}
// ================================= 账号配置解析 =================================
/**
 * 从环境变量读取账号配置：支持xlck（单个账号）、xlck1~xlck666（多个账号）
 * @returns {string[]} 去重后的账号配置字符串数组
 */
function getAccountConfigsFromEnv() {
  const configs = [];
  const seenConfigs = new Set(); // 用于去重
  
  // 读取单个账号配置（xlck）
  if (process.env.xlck) {
    const ksckValue = process.env.xlck;
    const configStrings = ksckValue
      .split("&")
      .map((config) => config.trim())
      .filter(Boolean);
    configs.push(...configStrings);
  }
  
  // 读取多个账号配置（xlck1~xlck666）
  for (let i = 1; i <= 666; i++) {
    const ksckKey = `xlck${i}`;
    if (process.env[ksckKey]) {
      const ksckValue = process.env[ksckKey];
      const configStrings = ksckValue
        .split("&")
        .map((config) => config.trim())
        .filter(Boolean);
      configs.push(...configStrings);
    }
  }
  
  // 去重处理
  const uniqueConfigs = [];
  for (const config of configs) {
    if (!seenConfigs.has(config)) {
      seenConfigs.add(config);
      uniqueConfigs.push(config);
    }
  }
  console.log(`从xlck及xlck1到xlck666环境变量中解析到 ${uniqueConfigs.length} 个唯一配置`);
  return uniqueConfigs;
}
/**
 * 解析单个账号配置字符串：支持格式（remark#ck#salt#proxy / ck#salt#proxy / ck#salt）
 * @param {string} configString - 账号配置字符串
 * @returns {object|null} 解析后的账号配置（remark、cookie、salt、proxyUrl）
 */
function parseAccountConfig(configString) {
  const parts = String(configString || "").trim().split("#");
  if (parts.length < 2) {
    return null;
  }
  
  let remark = ""; // 账号备注（可选）
  let cookie = ""; // 账号Cookie（必填）
  let salt = ""; // 签名盐值（必填）
  let proxyUrl = null; // Socks5代理地址（可选）
  
  if (parts.length === 2) {
    // 格式：ck#salt（无备注、无代理）
    cookie = parts[0];
    salt = parts[1];
  } else if (parts.length === 3) {
    // 格式1：remark#ck#salt（有备注、无代理）；格式2：ck#salt#proxy（无备注、有代理）
    if (/socks5:\/\//i.test(parts[2])) {
      cookie = parts[0];
      salt = parts[1];
      proxyUrl = parts[2];
    } else {
      remark = parts[0];
      cookie = parts[1];
      salt = parts[2];
    }
  } else if (parts.length >= 4) {
    // 格式：remark#ck#salt#proxy（有备注、有代理）
    remark = parts[0];
    cookie = parts[1];
    salt = parts.slice(2, parts.length - 1).join("#"); // 支持salt含#号
    proxyUrl = parts[parts.length - 1];
  }
  
  // 代理格式校验与转换：支持"ip|port|username|password"格式转socks5://URL
  if (proxyUrl) {
    if (proxyUrl.includes("|")) {
      console.log(`开始解析代理格式: ${proxyUrl}`);
      const proxyParts = proxyUrl.split("|");
      if (proxyParts.length >= 4) {
        const [ip, port, username, password] = proxyParts;
        proxyUrl = `socks5://${username}:${password}@${ip}:${port}`;
      } else {
        proxyUrl = null;
        console.log(`⚠️ 代理字段格式错误，忽略：${proxyUrl}`);
      }
    } else if (!/^socks5:\/\//i.test(proxyUrl)) {
      console.log(`⚠️ 代理字段不是 socks5:// URL，忽略：${proxyUrl}`);
      proxyUrl = null;
    }
  }
  
  return { remark, salt, cookie, proxyUrl };
}
/**
 * 加载所有有效账号配置：从环境变量解析并过滤无效配置
 * @returns {object[]} 有效账号配置数组（含index索引）
 */
function loadAccountsFromEnv() {
  const accountConfigs = getAccountConfigsFromEnv();
  const accounts = [];
  for (const configString of accountConfigs) {
    const accountConfig = parseAccountConfig(configString);
    if (accountConfig) {
      accounts.push(accountConfig);
    } else {
      console.log(`账号格式错误：${configString}`);
    }
  }
  // 给账号添加索引（从1开始）
  accounts.forEach((account, index) => {
    account.index = index + 1;
  });
  return accounts;
}
// ================================= 工具函数 =================================
/**
 * 生成快手设备ID（ANDROID_+16位随机十六进制字符串）
 * @returns {string} 设备ID
 */
function generateKuaishouDid() {
  try {
    const generateRandomHexString = (length) => {
      const hexChars = "0123456789abcdef";
      let result = "";
      for (let i = 0; i < length; i++) {
        result += hexChars.charAt(Math.floor(Math.random() * hexChars.length));
      }
      return result;
    };
    const randomId = generateRandomHexString(16);
    return "ANDROID_" + randomId;
  } catch (error) {
    console.log("生成did失败: " + error.message);
    const timestamp = Date.now().toString(16).toUpperCase();
    return "ANDROID_" + timestamp.substring(0, 16);
  }
}
/**
 * 发送网络请求：支持代理、超时设置，返回响应结果
 * @param {object} requestOptions - 请求配置（url、method、headers等）
 * @param {string|null} proxyUrl - 代理地址（socks5://）
 * @param {string} description - 请求描述（用于日志）
 * @returns {object} { response, body }
 */
async function sendRequest(requestOptions, proxyUrl = null, description = "Unknown Request") {
  const finalOptions = { ...requestOptions };
  let agent = null; // 代理实例
  
  // 配置代理
  if (proxyUrl) {
    try {
      agent = new SocksProxyAgent(proxyUrl);
      if (isDevMode) console.log(`[调试] ${description} 使用代理: ${proxyUrl}`);
    } catch (proxyError) {
      console.log(`[错误] ${description} 代理URL无效(${proxyError.message})，尝试直连模式`);
    }
  } else if (isDevMode) {
    console.log(`[调试] ${description} 未配置代理，使用直连模式`);
  }
  
  // 构建axios请求配置
  const axiosConfig = {
    method: finalOptions.method || "GET",
    url: finalOptions.url,
    headers: finalOptions.headers || {},
    data: finalOptions.body || finalOptions.form,
    timeout: finalOptions.timeout || 30000,
    ...(agent && { httpAgent: agent, httpsAgent: agent }), // 绑定代理
  };
  
  try {
    const response = await axios(axiosConfig);
    return { response, body: response.data };
  } catch (error) {
    if (error.response) {
      return { response: error.response, body: null };
    } else if (error.request) {
      if (error.name === "AggregateError" && Array.isArray(error.errors)) {
        console.log(`[调试] ${description} 请求错误: AggregateError\n` + error.errors.map((err, index) => `  [${index}] ${err?.message || err}`).join("\n"));
      } else if (isDevMode) {
        console.log(`[调试] ${description} 请求错误: ${error.message || String(error)}`);
      }
    } else if (isDevMode) {
      console.log(`[调试] ${description} 请求错误: ${error.message || String(error)}`);
    }
    return { response: null, body: null };
  }
}
/**
 * 测试代理连通性：通过访问httpbin.org/ip验证代理是否有效
 * @param {string} proxyUrl - 代理地址
 * @param {string} description - 描述（用于日志）
 * @returns {object} { ok, msg, ip }
 */
async function testProxyConnectivity(proxyUrl, description = "代理连通性检测") {
  if (!proxyUrl) {
    return { ok: true, msg: "✅ 未配置代理（直连模式）", ip: "localhost" };
  }
  
  const { body: baiduResult } = await sendRequest(
    {
      method: "GET",
      url: "https://httpbin.org/ip",
      headers: { "User-Agent": "ProxyTester/1.0" },
      timeout: 8000,
    },
    proxyUrl,
    description + " → httpbin.org"
  );
  
  if (baiduResult) {
    return {
      ok: true,
      msg: `✅ SOCKS5代理正常，成功访问 httpbin.org，出口IP: ${baiduResult.origin}`,
      ip: baiduResult.origin,
    };
  }
  return { ok: false, msg: "❌ 代理连通性检测失败", ip: null };
}
/**
 * 获取账号基本信息：昵称、当前金币、余额
 * @param {string} cookie - 账号Cookie
 * @param {string|null} proxyUrl - 代理地址
 * @param {string} accountId - 账号索引（用于日志）
 * @returns {object|null} { nickname, totalCoin, allCash }
 */
async function getAccountBasicInfo(cookie, proxyUrl, accountId = "?") {
  const url = "https://nebula.kuaishou.com/rest/n/nebula/activity/earn/overview/basicInfo?source=bottom_guide_first";
  const { body: result } = await sendRequest(
    {
      method: "GET",
      url: url,
      headers: {
        Host: "nebula.kuaishou.com",
        "User-Agent": "kwai-android aegon/4.36.0",
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 12000,
    },
    proxyUrl,
    `账号[${accountId}] 获取基本信息`
  );
  
  if (result && result.result === 1 && result.data) {
    return {
      nickname: result.data.userData?.nickname || null,
      totalCoin: result.data.totalCoin ?? null,
      allCash: result.data.allCash ?? null,
    };
  }
  return null;
}
/**
 * 并发执行函数：控制并发数执行异步任务
 * @param {array} items - 要执行的任务数组
 * @param {number} concurrency - 最大并发数
 * @param {function} processor - 单个任务处理函数
 * @returns {array} 所有任务结果
 */
async function concurrentExecute(items, concurrency, processor) {
  const results = new Array(items.length);
  let currentIndex = 0;
  
  async function worker() {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) return;
      const item = items[index];
      try {
        results[index] = await processor(item, index);
      } catch (error) {
        console.log(`并发执行异常（index=${index + 1}）：${error.message}`);
        results[index] = null;
      }
    }
  }
  
  // 创建指定数量的工作线程
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
// ================================= 快手广告任务核心类 =================================
class KuaishouAdTask {
  /**
   * 构造函数：初始化账号任务配置
   * @param {object} options - 配置参数
   * @param {number} options.index - 账号索引
   * @param {string} options.salt - 签名盐值
   * @param {string} options.cookie - 账号Cookie
   * @param {string} options.nickname - 账号昵称
   * @param {string|null} options.proxyUrl - 代理地址
   * @param {string[]} options.tasksToExecute - 要执行的任务列表
   * @param {string} options.remark - 账号备注
   * @param {number} options.initialCoin - 账号初始金币
   */
  constructor({
    index,
    salt,
    cookie,
    nickname = "",
    proxyUrl = null,
    tasksToExecute = ["food", "box", "look"],
    remark = "",
    initialCoin = 0,
  }) {
    this.index = index; // 账号索引
    this.salt = salt; // 签名盐值
    this.cookie = cookie; // 账号Cookie
    this.nickname = nickname || remark || `账号${index}`; // 账号昵称（优先级：昵称>备注>索引）
    this.remark = remark; // 账号备注
    this.proxyUrl = proxyUrl; // 代理地址
    this.tasksToExecute = tasksToExecute; // 要执行的任务列表
    this.initialCoin = initialCoin; // 初始金币（用于计算总收益）
    
    this.coinLimit = KSCOIN_LIMIT; // 金币上限
    this.coinExceeded = false; // 是否超出金币上限
    this.stopAllTasks = false; // 是否停止所有任务
    this.lowRewardStreak = 0; // 连续低奖励次数
    this.lowRewardThreshold = KSLOW_REWARD_THRESHOLD; // 低奖励阈值
    this.lowRewardLimit = KSLOW_REWARD_LIMIT; // 连续低奖励上限
    this.totalEarned = 0; // 本次运行累计获得金币
    this.taskExecMode = TASK_EXEC_MODE; // 任务执行模式（0=只初始，1=先初始后追加，2=只追加）
    this.enableLookCooldownCheck = ENABLE_LOOK_COOLDOWN_CHECK; // 绑定look任务冷却检测开关
    
    // 校验执行模式，非法值默认1
    if (![0, 1, 2].includes(this.taskExecMode)) {
      console.log(`⚠️ 账号[${this.nickname}] 执行模式配置非法（${TASK_EXEC_MODE}），默认使用模式1`);
      this.taskExecMode = 1;
    }
    
    // 任务限制状态：记录每个任务是否已达上限（仅通过接口result判断，与冷却无关）
    this.taskLimitReached = {};
    tasksToExecute.forEach((taskKey) => {
      this.taskLimitReached[taskKey] = false;
    });
    // 👇 加这行（失败计数器初始化）
    this.failCount = {};
    
// 新增：低奖励切换核心属性（所有任务统一，不影响look原有设置）
this.skippedLowRewardTasks = new Set(); // 存储被低奖励跳过的任务
this.taskLowRewardStreak = {}; // 每个任务的连续低奖励次数
tasksToExecute.forEach((taskKey) => {
  this.taskLowRewardStreak[taskKey] = 0;
});
 
    // 任务统计：成功次数、失败次数、总奖励
    this.taskStats = {};
    tasksToExecute.forEach((taskKey) => {
      this.taskStats[taskKey] = { success: 0, failed: 0, totalReward: 0 };
    });
    
    // 解析Cookie中的关键信息（egid、did、userId等）
    this.extractCookieInfo();
    
    // HTTP请求头配置
    this.headers = {
      Host: "nebula.kuaishou.com",
      Connection: "keep-alive",
      "User-Agent": "Mozilla/5.0 (Linux; Android 14; ${this.xlmod} Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36",
      Cookie: this.cookie,
      "content-type": "application/json",
    };
    
    // 任务报告接口路径
    this.taskReportPath = "/rest/r/ad/task/report";
    // 任务请求时间戳（用于签名）
    this.startTime = Date.now();
    this.endTime = this.startTime - 30000;
    // 接口查询参数（设备信息、版本号等）
    this.queryParams = `mod=${this.mod}&appver=${this.appver}&egid=${this.egid}&did=${this.did}`;
    
    // 核心任务配置：每个任务的固定参数（仅requestSceneType和taskType在执行时动态替换）
    this.taskConfigs = {
      box: {
        name: "宝箱广告",
        businessId: 7002,
        posId: 20346,
        subPageId: 100024064,
      },
      look: {
        name: "看广告得金币",
        businessId: 7002,
        posId: 24067,
        subPageId: 100026367,
      },
      food: {
        name: "饭补广告",
        businessId: 7002,
        posId: 24067,
        subPageId: 100026367,
      },
      food1: {
        name: "饭补广告1",
        businessId: 7002,
        posId: 28704,
        subPageId: 100029275,
      },
      food2: {
        name: "签到广告",
        businessId: 7002,
        posId: 20342,
        subPageId: 100024058,
      },
     };
  }
  
  /**
 * 解析Cookie中的关键信息：所有与URL对应的参数（从Cookie自动读取，修复语法错误）
 */
extractCookieInfo() {
  try {
    // 核心参数解析（按URL顺序排列，修复语法错误+确保const定义规范）
    const egidMatch = this.cookie.match(/egid=([^;]+)/);
    const didMatch = this.cookie.match(/did=([^;]+)/);
    const userIdMatch = this.cookie.match(/userId=([^;]+)/);
    const apiStMatch = this.cookie.match(/kuaishou\.api_st=([^;]+)/);
    const appverMatch = this.cookie.match(/appver=([^;]+)/);
    const earphoneModeMatch = this.cookie.match(/earphoneMode=([^;]+)/);
    const modMatch = this.cookie.match(/mod=([^;]+)/);
    const ispMatch = this.cookie.match(/isp=([^;]+)/);
    const languageMatch = this.cookie.match(/language=([^;]+)/);
    const udMatch = this.cookie.match(/ud=([^;]+)/);
    const didTagMatch = this.cookie.match(/did_tag=([^;]+)/);
    const thermalMatch = this.cookie.match(/thermal=([^;]+)/);
    const netMatch = this.cookie.match(/net=([^;]+)/);
    const kcvMatch = this.cookie.match(/kcv=([^;]+)/);
    const appMatch = this.cookie.match(/app=([^;]+)/);
    const kpfMatch = this.cookie.match(/kpf=([^;]+)/);
    const bottomNavigationMatch = this.cookie.match(/bottom_navigation=([^;]+)/);
    const verMatch = this.cookie.match(/ver=([^;]+)/);
    const androidOsMatch = this.cookie.match(/android_os=([^;]+)/);
    const oDidMatch = this.cookie.match(/oDid=([^;]+)/);
    const boardPlatformMatch = this.cookie.match(/boardPlatform=([^;]+)/);
    const kpnMatch = this.cookie.match(/kpn=([^;]+)/);
    const newOcMatch = this.cookie.match(/newOc=([^;]+)/);
    const androidApiLevelMatch = this.cookie.match(/androidApiLevel=([^;]+)/);
    const slhMatch = this.cookie.match(/slh=([^;]+)/);
    const countryCodeMatch = this.cookie.match(/country_code=([^;]+)/);
    const nbhMatch = this.cookie.match(/nbh=([^;]+)/);
    const hotfixVerMatch = this.cookie.match(/hotfix_ver=([^;]+)/);
    const didGtMatch = this.cookie.match(/did_gt=([^;]+)/);
    const keyconfigStateMatch = this.cookie.match(/keyconfig_state=([^;]+)/);
    const cdidTagMatch = this.cookie.match(/cdid_tag=([^;]+)/);
    const sysMatch = this.cookie.match(/sys=([^;]+)/);
    const maxMemoryMatch = this.cookie.match(/max_memory=([^;]+)/);
    const coldLaunchTimeMsMatch = this.cookie.match(/cold_launch_time_ms=([^;]+)/);
    const ocMatch = this.cookie.match(/oc=([^;]+)/);
    const shMatch = this.cookie.match(/sh=([^;]+)/);
    const deviceBitMatch = this.cookie.match(/deviceBit=([^;]+)/);
    const browseTypeMatch = this.cookie.match(/browseType=([^;]+)/);
    const ddpiMatch = this.cookie.match(/ddpi=([^;]+)/);
    const socNameMatch = this.cookie.match(/socName=([^;]+)/);
    const isBackgroundMatch = this.cookie.match(/is_background=([^;]+)/);
    const cMatch = this.cookie.match(/c=([^;]+)/);
    const swMatch = this.cookie.match(/sw=([^;]+)/);
    const fttMatch = this.cookie.match(/ftt=([^;]+)/);
    const apptypeMatch = this.cookie.match(/apptype=([^;]+)/);
    const abiMatch = this.cookie.match(/abi=([^;]+)/);
    const userRecoBitMatch = this.cookie.match(/userRecoBit=([^;]+)/);
    const deviceAbiMatch = this.cookie.match(/device_abi=([^;]+)/);
    const icaverMatch = this.cookie.match(/icaver=([^;]+)/); // 修复：const 后加空格
    const totalMemoryMatch = this.cookie.match(/totalMemory=([^;]+)/);
    const grantBrowseTypeMatch = this.cookie.match(/grant_browse_type=([^;]+)/);
    const iuidMatch = this.cookie.match(/iuid=([^;]+)/);
    const rdidMatch = this.cookie.match(/rdid=([^;]+)/);
    const sbhMatch = this.cookie.match(/sbh=([^;]+)/);
    const darkModeMatch = this.cookie.match(/darkMode=([^;]+)/);
    // 赋值给实例变量（增加兜底，避免未定义）
    this.egid = egidMatch ? egidMatch[1] : "";
    this.did = didMatch ? didMatch[1] : generateKuaishouDid();
    this.userId = userIdMatch ? userIdMatch[1] : "";
    this.kuaishouApiSt = apiStMatch ? apiStMatch[1] : ""; // 签名核心参数，必须有值
    this.appver = appverMatch ? appverMatch[1] : "13.10.30.10868"; // 兜底常用版本
    this.earphoneMode = earphoneModeMatch ? earphoneModeMatch[1] : "1";
    this.mod = modMatch ? modMatch[1] : "Xiaomi(23013RK75C)";
    this.xlmod = decodeURIComponent(this.mod).match(/\(([^)]+)\)/)[1].replace(/\+/g, ' '); // 把所有+号换成空格（g表示全局替换）
    this.isp = ispMatch ? ispMatch[1] : "CTCC";
    this.language = languageMatch ? languageMatch[1] : "zh-cn";
    this.ud = udMatch ? udMatch[1] : this.userId || "123456789";
    this.did_tag = didTagMatch ? didTagMatch[1] : "0";
    this.thermal = thermalMatch ? thermalMatch[1] : "10000";
    this.net = netMatch ? netMatch[1] : "WIFI";
    this.kcv = kcvMatch ? kcvMatch[1] : "1604";
    this.app = appMatch ? appMatch[1] : "0";
    this.kpf = kpfMatch ? kpfMatch[1] : "ANDROID_PHONE";
    this.bottom_navigation = bottomNavigationMatch ? bottomNavigationMatch[1] : "true";
    this.ver = verMatch ? verMatch[1] : "13.10";
    this.android_os = androidOsMatch ? androidOsMatch[1] : "0";
    this.oDid = oDidMatch ? oDidMatch[1] : `ANDROID_${Date.now().toString(16)}`;
    this.boardPlatform = boardPlatformMatch ? boardPlatformMatch[1] : "lito";
    this.kpn = kpnMatch ? kpnMatch[1] : "NEBULA";
    this.newOc = newOcMatch ? newOcMatch[1] : "XIAOMI";
    this.androidApiLevel = androidApiLevelMatch ? androidApiLevelMatch[1] : "31";
    this.slh = slhMatch ? slhMatch[1] : "0";
    this.country_code = countryCodeMatch ? countryCodeMatch[1] : "cn";
    this.nbh = nbhMatch ? nbhMatch[1] : "130";
    this.hotfix_ver = hotfixVerMatch ? hotfixVerMatch[1] : "";
    this.did_gt = didGtMatch ? didGtMatch[1] : Date.now().toString();
    this.keyconfig_state = keyconfigStateMatch ? keyconfigStateMatch[1] : "1";
    this.cdid_tag = cdidTagMatch ? cdidTagMatch[1] : "2";
    this.sys = sysMatch ? sysMatch[1] : "ANDROID_12";
    this.max_memory = maxMemoryMatch ? maxMemoryMatch[1] : "256";
    this.cold_launch_time_ms = coldLaunchTimeMsMatch ? coldLaunchTimeMsMatch[1] : Date.now().toString();
    this.oc = ocMatch ? ocMatch[1] : "XIAOMI";
    this.sh = shMatch ? shMatch[1] : "2400";
    this.deviceBit = deviceBitMatch ? deviceBitMatch[1] : "4";
    this.browseType = browseTypeMatch ? browseTypeMatch[1] : "3";
    this.ddpi = ddpiMatch ? ddpiMatch[1] : "440";
    this.socName = socNameMatch ? socNameMatch[1] : "Qualcomm+Snapdragon+7250";
    this.is_background = isBackgroundMatch ? isBackgroundMatch[1] : "0";
    this.c = cMatch ? cMatch[1] : "XIAOMI";
    this.sw = swMatch ? swMatch[1] : "1080";
    this.ftt = fttMatch ? fttMatch[1] : "bd-T-T";
    this.apptype = apptypeMatch ? apptypeMatch[1] : "22";
    this.abi = abiMatch ? abiMatch[1] : "arm64";
    this.userRecoBit = userRecoBitMatch ? userRecoBitMatch[1] : "0";
    this.device_abi = deviceAbiMatch ? deviceAbiMatch[1] : "arm64";
    this.icaver = icaverMatch ? icaverMatch[1] : "1"; // 修复：变量名对应
    this.totalMemory = totalMemoryMatch ? totalMemoryMatch[1] : "5426";
    this.grant_browse_type = grantBrowseTypeMatch ? grantBrowseTypeMatch[1] : "AUTHORIZED";
    this.iuid = iuidMatch ? iuidMatch[1] : "";
    this.rdid = rdidMatch ? rdidMatch[1] : `ANDROID_${Date.now().toString(16)}`;
    this.sbh = sbhMatch ? sbhMatch[1] : "95";
    this.darkMode = darkModeMatch ? darkModeMatch[1] : "false";
    // 关键参数校验（避免签名失败）
    if (!this.kuaishouApiSt) {
      console.warn(`⚠️ 账号[${this.nickname}] Cookie中未找到 kuaishou.api_st，可能导致签名失败`);
    }
    if (!this.salt) {
      console.error(`❌ 账号[${this.nickname}] 未配置 salt，无法生成签名`);
    }
    console.log(`✅ 固定UA：原始mod=${this.mod} → 提取型号=${this.xlmod}`);
    console.log(`✅ Cookie参数解析完成，核心参数：appver=${this.appver}、kpn=${this.kpn}、net=${this.net}`);
  } catch (error) {
    console.log(`❌ 解析cookie失败: ${error.message}`);
    // 异常兜底：赋值默认核心参数，避免脚本中断
    this.kuaishouApiSt = this.kuaishouApiSt || "";
    this.appver = this.appver || "13.10.30.10868";
    this.kpn = this.kpn || "NEBULA";
    this.did = this.did || generateKuaishouDid();
  }
}
  
  /**
   * 检查金币是否超出上限：超出则停止任务
   * @returns {boolean} 是否超出上限
   */
  async checkCoinLimit() {
    try {
      const accountInfo = await getAccountBasicInfo(this.cookie, this.proxyUrl, this.index);
      if (accountInfo && accountInfo.totalCoin) {
        const currentCoin = parseInt(accountInfo.totalCoin);
        if (currentCoin >= this.coinLimit) {
          console.log(`⚠️ 账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 金币已达 ${currentCoin}，超过 ${this.coinLimit} 阈值，将停止任务`);
          this.coinExceeded = true;
          this.stopAllTasks = true;
          return true;
        }
      }
      return false;
    } catch (error) {
      // 修复笔误：thisthis.nickname → this.nickname
      console.log(`账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 金币检查异常: ${error.message}`);
      return false;
    }
  }
  /**
   * 新增：look任务冷却检测（仅针对look任务）
   * @returns {object} { isCooling: 布尔值 }
   */
  async checkLookTaskCoolDown() {
    try {
      const url = "https://nebula.kuaishou.com/rest/n/nebula/activity/earn/overview/tasks?" + querystring.stringify({});
      const { body: result } = await sendRequest({
        method: "GET",
        url: url,
        headers: {
          Cookie: this.cookie,
          "User-Agent": "Mozilla/5.0 (Linux; Android 14; ${this.xlmod} Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.212 KsWebView/1.8.121.900 Mobile Safari/537.36",
          Referer: "https://nebula.kuaishou.com/nebula/task/earning"
        },
        timeout: 5000
      }, this.proxyUrl, `账号[${this.nickname}] look任务冷却检测`);
      if (!result || result.result !== 1 || !result.data?.dailyTasks) {
        return { isCooling: false };
      }
      const lookTask = result.data.dailyTasks.find(task => task.id === 17);
      if (!lookTask) {
        return { isCooling: false };
      }
      const isCooling = lookTask.linkText === "冷却中";
      return { isCooling };
    } catch (error) {
      console.log(`⚠️ 账号[${this.nickname}] look任务冷却检测异常: ${error.message}`);
      return { isCooling: false };
    }
  }
 
/**
 * 新增：检查是否只剩look任务可执行（排除被低奖励跳过的任务）
 * @returns {boolean} 是否只剩look任务
 */
isOnlyLookTaskAvailable() {
  const availableTasks = this.tasksToExecute.filter(taskKey => 
    !this.taskLimitReached[taskKey] && !this.skippedLowRewardTasks.has(taskKey)
  );
  return availableTasks.length === 1 && availableTasks[0] === "look";
}
  
  /**
   * 获取任务统计信息
   * @returns {object} 任务统计
   */
  getTaskStats() {
    return this.taskStats;
  }
  
  /**
   * 打印任务执行统计
   */
  printTaskStats() {
    console.log(`\n账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 任务执行统计（模式${this.taskExecMode}）:`);
    for (const [taskKey, stats] of Object.entries(this.taskStats)) {
      const taskName = this.taskConfigs[taskKey]?.name || taskKey;
      console.log(`  ${taskName}: 成功${stats.success}次, 失败${stats.failed}次, 总奖励${stats.totalReward}金币`);
    }
    console.log(`  本次运行累计获得金币: ${this.totalEarned}`);
  }
  
  /**
   * 重试操作：失败后自动重试指定次数
   * @param {function} operation - 要执行的异步操作
   * @param {string} description - 操作描述（用于日志）
   * @param {number} maxRetries - 最大重试次数（默认3次）
   * @param {number} delay - 重试间隔（默认2000ms）
   * @returns {any|null} 操作结果（失败返回null）
   */
  async retryOperation(operation, description, maxRetries = 3, delay = 2000) {
    let attempts = 0;
    let lastError = null;
    while (attempts < maxRetries) {
      try {
        const result = await operation();
        if (result) return result;
        lastError = new Error(description + " 返回空结果");
      } catch (error) {
        lastError = error;
        console.log(`账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} ${description} 异常: ${error.message}`);
      }
      attempts++;
      if (attempts < maxRetries) {
        console.log(`账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} ${description} 失败，重试 ${attempts}/${maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    if (isDevMode && lastError) console.log(`[调试] ${description} 最终失败: ${lastError.message}`);
    return null;
  }
  
/**
 * 获取广告信息：根据任务配置请求广告创意ID等关键信息
 * @param {object} taskConfig - 任务配置（含businessId、posId等）
 * @param {string} taskKey - 任务key（新增！用于计数）
 * @returns {object|null} 广告信息（cid、llsid）
 */
async getAdInfo(taskConfig, taskKey) { // 新增 taskKey 参数
  try {
    const adPath = "/rest/e/reward/mixed/ad";
    const formData = {
      encData: "|encData|",
      sign: "|sign|",
      cs: "false",
      client_key: "2ac2a76d",
      videoModelCrowdTag: "1_50",
      os: "android",
      "kuaishou.api_st": this.kuaishouApiSt,
      uQaTag: "513#33333333336666666666#ecBl:11#cmWns:-2#swRs:-9#swLdgl:-0#ecPp:-5#cmNt:-0#cmHs:-3#cmMnsl:-0#cmAu:-2",
    };
    const queryData = {
      earphoneMode: this.earphoneMode,
      mod: this.mod,
      appver: this.appver,
      isp: this.isp,
      language: this.language,
      ud: this.ud,
      did_tag: this.did_tag,
      net: this.net,
      kcv: this.kcv,
      app: this.app,
      kpf: this.kpf,
      ver: this.ver,
      android_os: this.android_os,
      boardPlatform: this.boardPlatform,
      kpn: this.kpn,
      androidApiLevel: this.androidApiLevel,
      country_code: this.country_code,
      sys: this.sys,
      sw: this.sw,
      sh: this.sh,
      abi: this.abi,
      userRecoBit: this.userRecoBit,
      oDid: this.oDid,
      newOc: this.newOc,
      slh: this.slh,
      nbh: this.nbh,
      hotfix_ver: this.hotfix_ver,
      did_gt: this.did_gt,
      keyconfig_state: this.keyconfig_state,
      cdid_tag: this.cdid_tag,
      max_memory: this.max_memory,
      cold_launch_time_ms: this.cold_launch_time_ms,
      oc: this.oc,
      deviceBit: this.deviceBit,
      browseType: this.browseType,
      ddpi: this.ddpi,
      socName: this.socName,
      is_background: this.is_background,
      c: this.c,
      ftt: this.ftt,
      apptype: this.apptype,
      device_abi: this.device_abi,
      icaver: this.icaver,
      totalMemory: this.totalMemory,
      grant_browse_type: this.grant_browse_type,
      iuid: this.iuid,
      rdid: this.rdid,
      sbh: this.sbh,
      darkMode: this.darkMode,
      did: this.did,
      thermal: this.thermal,
      bottom_navigation: this.bottom_navigation,
    };
    const requestBody = {
      appInfo: { appId: "kuaishou_nebula", name: "快手极速版", packageName: "com.kuaishou.nebula", version: this.appver, versionCode: -1 },
      deviceInfo: { osType: 1, osVersion: this.sys.replace("ANDROID_", ""), deviceId: this.did, screenSize: { width: this.sw, height: this.sh }, ftt: "" },
      userInfo: { userId: this.userId, age: 0, gender: "" },
      impInfo: [{ pageId: 11101, subPageId: taskConfig.subPageId, action: 0, browseType: 3, impExtData: "{}", mediaExtData: "{}" }],
    };
    const encodedBody = Buffer.from(JSON.stringify(requestBody)).toString("base64");
    
    // 获取签名（增加非空校验）
    let encsign = await this.getSign(encodedBody);
    if (!encsign || !encsign.encdata || !encsign.sign) {
      console.error(`❌ 账号[${this.nickname}] 获取encsign签名失败`);
      // 失败计数
      this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
      if (this.failCount[taskKey] >= 5) {
        console.log(`🛑 账号[${this.nickname}] ${taskConfig.name} 连续失败5次，强制停止所有任务`);
        this.stopAllTasks = true;
      }
      return null;
    }
    formData.encData = encsign.encdata;
    formData.sign = encsign.sign;
    
    // 获取接口签名（增加非空校验）
    let nesig = await this.requestSignService({
      urlpath: adPath,
      reqdata: qs.stringify(formData) + "&" + qs.stringify(queryData),
      api_client_salt: this.salt,
    });
    if (!nesig || !nesig.sig) {
      console.error(`❌ 账号[${this.nickname}] 获取nssig签名失败（salt可能错误）`);
      // 失败计数
      this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
      if (this.failCount[taskKey] >= 5) {
        console.log(`🛑 账号[${this.nickname}] ${taskConfig.name} 连续失败5次，强制停止所有任务`);
        this.stopAllTasks = true;
      }
      return null;
    }
    
    const finalQueryData = {
      ...queryData,
      sig: nesig.sig,
      __NS_sig3: nesig.__NS_sig3,
      __NS_xfalcon: "",
      __NStokensig: nesig.__NStokensig,
    };
    const url = "https://api.e.kuaishou.com" + adPath + "?" + querystring.stringify(finalQueryData);
    
    const { body: result } = await sendRequest(
      {
        method: "POST",
        url: url,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Host: "api.e.kuaishou.com",
          "User-Agent": "kwai-android aegon/4.36.0",
          Cookie: "kuaishou_api_st=" + this.kuaishouApiSt,
        },
        form: formData,
        timeout: 12000,
      },
      this.proxyUrl,
      `账号[${this.nickname}] 获取${taskConfig.name}广告`
    );
    
    if (!result) {
      // 失败计数
      this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
      if (this.failCount[taskKey] >= 5) {
        console.log(`🛑 账号[${this.nickname}] ${taskConfig.name} 连续失败5次，强制停止所有任务`);
        this.stopAllTasks = true;
      }
      return null;
    }
    if (result.errorMsg === "OK" && result.feeds && result.feeds[0] && result.feeds[0].ad) {
      const expTag = result.feeds[0].exp_tag || "";
      const llsid = expTag.split("/")[1]?.split("_")?.[0] || "";
      // 成功后重置计数
      this.failCount[taskKey] = 0;
      return { cid: result.feeds[0].ad.creativeId, llsid: llsid };
    }
    console.log(`⚠️ 账号[${this.nickname}] 获取${taskConfig.name}广告无有效数据，响应：${JSON.stringify(result)}`);
    // 失败计数
    this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
    if (this.failCount[taskKey] >= 5) {
      console.log(`🛑 账号[${this.nickname}] ${taskConfig.name} 连续失败5次，强制停止所有任务`);
      this.stopAllTasks = true;
    }
    return null;
  } catch (error) {
    console.log(`❌ 账号[${this.nickname}] 获取${taskConfig.name}广告异常: ${error.message}`);
    // 失败计数
    this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
    if (this.failCount[taskKey] >= 5) {
      console.log(`🛑 账号[${this.nickname}] ${taskConfig.name} 连续失败5次，强制停止所有任务`);
      this.stopAllTasks = true;
    }
    return null;
  }
}
  
  /**
   * 生成广告任务签名：用于提交任务报告时的身份验证
   * @param {string} creativeId - 广告创意ID
   * @param {string} llsid - 广告会话ID
   * @param {string} taskKey - 任务key
   * @param {object} taskConfig - 任务配置
   * @returns {object|null} 签名信息（sig、sig3、sigtoken、post）
   */
  async generateSignature(creativeId, llsid, taskKey, taskConfig) {
    try {
      // 业务数据（用于生成签名）
      const bizData = JSON.stringify({
        businessId: taskConfig.businessId,
        endTime: this.endTime,
        extParams: "05e3a64656e43dae5cfc67d099475a21145a9c83f24d3b6e1cb72fea7cb3f8aedaf7a723df3d31b5ddc13415a56789bc17334231c74cf79e7aa81cc91e43a8cfa6aa4932a897b1900cea6f5203126b7ca3f84fcad57a3d8304bb22e91e87852143b64c019baa14451d54f15bd41a3e460b09d7609ad51935e569b821da6b67f9c645b2894c3cbfe4bb00f337134d60f0",
        mediaScene: "video",
        neoInfos: [{
          creativeId: creativeId,
          extInfo: "",
          llsid: llsid,
          requestSceneType: taskConfig.requestSceneType,
          taskType: taskConfig.taskType,
          watchExpId: "",
          watchStage: 0,
        }],
        pageId: 11101,
        posId: taskConfig.posId,
        reportType: 0,
        sessionId: "",
        startTime: this.startTime,
        subPageId: taskConfig.subPageId,
      });
      
      // 提交数据
      const postData = "bizStr=" + encodeURIComponent(bizData) + "&cs=false&client_key=2ac2a76d&kuaishou.api_st=" + this.kuaishouApiSt;
      const urlData = this.queryParams + "&" + postData;
      
      // 调用本地签名服务生成签名
      const signResult = await this.requestSignService(
        { urlpath: this.taskReportPath, reqdata: urlData, api_client_salt: this.salt },
        `账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 生成${taskConfig.name}签名`
      );
      
      return {
        sig: signResult.sig,
        sig3: signResult.__NS_sig3,
        sigtoken: signResult.__NStokensig,
        post: postData,
      };
    } catch (error) {
      console.log(`❌ 账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 生成${taskConfig.name}签名异常: ${error.message}`);
      return null;
    }
  }
  /**
   * 提交任务报告：获取广告奖励
   * @param {string} sig - 签名
   * @param {string} sig3 - 补充签名
   * @param {string} sigtoken - token签名
   * @param {string} postData - 提交数据
   * @param {string} taskKey - 任务key
   * @param {object} taskConfig - 任务配置
   * @returns {object} { success, reward }
   */
  async submitReport(sig, sig3, sigtoken, postData, taskKey, taskConfig) {
    try {
      // 构建请求URL
      const url = "https://api.e.kuaishou.com" + this.taskReportPath + "?" + (this.queryParams + "&sig=" + sig + "&__NS_sig3=" + sig3 + "&__NS_xfalcon=&__NStokensig=" + sigtoken);
      
      // 发送提交请求
      const { body: result } = await sendRequest(
        {
          method: "POST",
          url: url,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Host: "api.e.kuaishou.cn",
            "User-Agent": "kwai-android aegon/4.36.0",
          },
          body: postData,
          timeout: 12000,
        },
        this.proxyUrl,
        `账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 提交${taskConfig.name}任务`
      );
      
      if (!result) return { success: false, reward: 0 };
      
         
          
     // 任务成功：获取奖励金币
if (result.result === 1) {
  const reward = result.data?.neoAmount || 0;
  // 修复：合并金币日志，去掉多余重复项，保留1条含累计+总计
  console.log(`${this.remark ? "（" + this.remark + "）" : ""} 获得${reward}金币奖励！ 累计：${this.totalEarned}，总计：${this.initialCoin + this.totalEarned + reward}`);
  // 累计奖励并检查低奖励
  this.totalEarned += reward;
  
  // 👇 新增：任务级低奖励逻辑（所有任务统一，替代原有全局低奖励停止）
  if (reward <= this.lowRewardThreshold) {
    this.taskLowRewardStreak[taskKey] += 1;
 //   this.did = generateKuaishouDid(); // 低奖励时重置设备ID
    console.log(`⚠️ 账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 【${taskConfig.name}】金币奖励(${reward})低于阈值(${this.lowRewardThreshold})，当前任务连续低奖励次数：${this.taskLowRewardStreak[taskKey]}/${this.lowRewardLimit}`);
    
    // 连续低奖励达到上限：标记跳过该任务，切换下一个，不停止
    if (this.taskLowRewardStreak[taskKey] >= this.lowRewardLimit) {
      this.skippedLowRewardTasks.add(taskKey);
      console.log(`⚠️ 账号[${this.nickname}] 【${taskConfig.name}】连续低奖励达上限，暂时跳过，切换下一个任务`);
      this.taskLowRewardStreak[taskKey] = 0;
    }
  } else {
    // 奖励正常：重置该任务低奖励次数，移除跳过标记
    this.taskLowRewardStreak[taskKey] = 0;
    this.skippedLowRewardTasks.delete(taskKey);
  }
        // 新增：look任务领取奖励后检测冷却（加开关判断）
        if (taskKey === "look" && this.enableLookCooldownCheck) {
          const { isCooling } = await this.checkLookTaskCoolDown();
          if (isCooling) {
            console.log(`⚠️ 账号[${this.nickname}] look任务广告处于冷却中`);
            
            // 只剩look任务且冷却，停止所有
            if (this.isOnlyLookTaskAvailable()) {
              console.log(`🏁 账号[${this.nickname}] 只剩look任务且广告处于冷却中，停止所有任务`);
              this.stopAllTasks = true;
            }
          }
        }
        return { success: true, reward: reward };
      }
      
      // 任务达上限：仅通过接口result判断，与冷却无关
      if ([20107, 20108, 1003, 415].includes(result.result)) {
        console.log(`⚠️ ${this.remark ? "（" + this.remark + "）" : ""} ${taskConfig.name} 已达上限`);
        this.taskLimitReached[taskKey] = true;
        return { success: false, reward: 0 };
      }
      
      // 其他失败情况
      console.log(`❌ ${this.remark ? "（" + this.remark + "）" : ""} ${taskConfig.name} 奖励失败，result=${result.result} msg=${result.data || ""}`);
      if (isDevMode) console.log(`[调试] submitReport 原始响应:`, JSON.stringify(result));
      return { success: false, reward: 0 };
    } catch (error) {
      console.log(`❌ ${this.remark ? "（" + this.remark + "）" : ""} 提交${taskConfig.name}任务异常: ${error.message}`);
      return { success: false, reward: 0 };
    }
  }
  
  /**
   * 调用本地签名服务（encsign接口）
   * @param {string} requestData - 请求数据
   * @returns {object} 签名结果
   */
  async getSign(requestData) {
    try {
      const { body: result } = await sendRequest({
        method: "POST",
        url: "http://61.140.235.250:13315/encsign",
        body: JSON.stringify({ data: requestData }),
        headers: { "Content-Type": "application/json" },
      });
      if (result && result.status) return result.data;
    } catch (error) {}
    // 兜底返回默认值
    return { encdata: "|encdata|", sign: "|sign|" };
  }
  
  /**
   * 调用本地签名服务（nssig接口）
   * @param {object} requestData - 请求数据（urlpath、reqdata、salt）
   * @param {string} description - 描述（用于日志）
   * @returns {object|null} 签名结果
   */
  async requestSignService(requestData, description) {
    let returnData = {};
    const newreqdata = {
      path: requestData.urlpath,
      data: requestData.reqdata,
      salt: requestData.api_client_salt,
    };
    
    const { body: result } = await sendRequest(
      {
        method: "POST",
        url: "http://61.140.235.250:13315/nssig",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify(newreqdata),
        timeout: 15000,
      },
      null,
      description + "（签名服务）"
    );
    
    if (result && result.data) {
      Object.assign(returnData, {
        __NS_sig3: result.data.nssig3,
        __NStokensig: result.data.nstokensig,
        sig: result.data.sig,
      });
      return returnData;
    }
    return null;
  }
  
/**
 * 执行单次任务（动态传入requestSceneType和taskType）
 * @param {string} taskKey - 任务key
 * @param {object} taskConfig - 基础任务配置
 * @param {object} customParams - 自定义参数（requestSceneType、taskType、isInitVersion）
 * @returns {object} { success, reward }
 */
async executeSingleTaskWithParams(taskKey, taskConfig, customParams) {
  try {
    // look任务执行前先检测冷却（新增开关判断）
    if (taskKey === "look" && this.enableLookCooldownCheck) {
      const { isCooling } = await this.checkLookTaskCoolDown();
      if (isCooling) {
        console.log(`⚠️ 账号[${this.nickname}] look任务广告处于冷却中，停止后续执行`);
        this.taskLimitReached[taskKey] = true;
        return { success: false, reward: 0 };
      }
    }
    // 合并基础配置和自定义参数（动态替换requestSceneType和taskType）
    const finalTaskConfig = { ...taskConfig, ...customParams };
    
    // 获取广告信息
const adInfo = await this.retryOperation(
  () => this.getAdInfo(finalTaskConfig, taskKey), // 修复：传入taskKey参数
  `${finalTaskConfig.name}获取广告信息`,
  3
);
if (!adInfo) {
  console.log(`❌ ${finalTaskConfig.name} 获取广告失败`);
  return { success: false, reward: 0 };
} else {
  // 关键修改：添加任务类型前缀
  const taskTypeLabel = finalTaskConfig.isInitVersion ? "(初始广告)" : "(追加广告)";
  console.log(`✅ ${taskTypeLabel} ${finalTaskConfig.name} 成功获取广告`);
}
   // 步骤2：观看广告等待（随机范围由环境变量控制，look任务独立配置）
 let watchTime = 0;
 if (taskKey === 'look') {
   // look任务：按 LOOK_WATCH_SECONDS_MIN ~ LOOK_WATCH_SECONDS_MAX 随机
   watchTime = Math.floor(Math.random() * (LOOK_WATCH_SECONDS_MAX - LOOK_WATCH_SECONDS_MIN + 1)) + LOOK_WATCH_SECONDS_MIN;
 } else {
   // 其他任务（饭补/宝箱/翻倍等）：按 GLOBAL_WATCH_SECONDS_MIN ~ GLOBAL_WATCH_SECONDS_MAX 随机
   watchTime = Math.floor(Math.random() * (GLOBAL_WATCH_SECONDS_MAX - GLOBAL_WATCH_SECONDS_MIN + 1)) + GLOBAL_WATCH_SECONDS_MIN;
 }
 const watchTimeMs = watchTime * 1000;
 if (watchTimeMs > 0) {
   console.log(`${finalTaskConfig.name}等待${watchTime}秒（范围${taskKey === 'look' ? `${LOOK_WATCH_SECONDS_MIN}-${LOOK_WATCH_SECONDS_MAX}` : `${GLOBAL_WATCH_SECONDS_MIN}-${GLOBAL_WATCH_SECONDS_MAX}`}秒）`);
   await new Promise(resolve => setTimeout(resolve, watchTimeMs));
 }
 
    // 步骤3：生成签名
const signature = await this.retryOperation(
  () => this.generateSignature(adInfo.cid, adInfo.llsid, taskKey, finalTaskConfig),
  `${finalTaskConfig.name}生成签名`,
  3
);
if (!signature) {
  this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
  if (this.failCount[taskKey] >= 5) {
    this.stopAllTasks = true;
  }
  return { success: false, reward: 0 };
}
// 新增：提交奖励前延时（无重复，保留1次）
if (SUBMIT_BEFORE_DELAY > 0) {
  console.log(`还剩 ${SUBMIT_BEFORE_DELAY / 1000} 秒获得奖励`);
  await new Promise(resolve => setTimeout(resolve, SUBMIT_BEFORE_DELAY));
}
// 步骤4：提交任务报告
const submitResult = await this.retryOperation(
  () => this.submitReport(
    signature.sig,
    signature.sig3,
    signature.sigtoken,
    signature.post,
    taskKey,
    finalTaskConfig
  ),
  `${finalTaskConfig.name}提交报告`,
  3
);
    return {
      success: submitResult?.success || false,
      reward: submitResult?.reward || 0
    };
  } catch (error) {
    console.log(`❌ 账号[${this.nickname}] ${taskConfig.name}执行异常: ${error.message}`);
    this.failCount[taskKey] = (this.failCount[taskKey] || 0) + 1;
    if (this.failCount[taskKey] >= 5) {
      console.log(`🛑 账号[${this.nickname}] ${taskConfig.name} 连续失败5次，强制停止所有任务`);
      this.stopAllTasks = true;
    }
    return { success: false, reward: 0 };
  }
}

/**
 * 执行单个任务：根据TASK_EXEC_MODE控制执行逻辑
 * 0 = 只跑初始广告（requestSceneType=1，taskType=1），循环执行TASK_COUNTS次数
 * 1 = 先跑1次初始广告，再跑追加广告（默认）
 * 2 = 只跑追加广告（requestSceneType=7，taskType=2）
 * @param {string} taskKey - 任务key
 * @returns {object} { success, reward }
 */
async executeTask(taskKey) {
  const taskConfig = this.taskConfigs[taskKey];
  if (!taskConfig) {
    console.log(`❌ 账号[${this.nickname}]${this.remark ? "（" + this.remark + "）" : ""} 未知任务: ${taskKey}`);
    return { success: false, reward: 0 };
  }
  if (this.taskLimitReached[taskKey] || this.stopAllTasks || this.skippedLowRewardTasks.has(taskKey)) {
    console.log(`⚠️ ${this.remark ? "（" + this.remark + "）" : ""} ${taskConfig.name} 已达上限/停止/低奖励跳过，跳过`);
    return { success: false, reward: 0 };
  }
  
  console.log(`\n📌 账号[${this.nickname}] 开始执行${taskConfig.name}（执行模式${this.taskExecMode}），共${TASK_COUNTS[taskKey]}次`);
  let initTaskResult = { success: false, reward: 0 };
  let formalTaskResult = { success: false, reward: 0 };
  const perRoundCount = TASK_COUNTS[taskKey] || 0;
  
  // 模式0：只执行初始版广告
  if (this.taskExecMode === 0) {
    let totalInitSuccess = 0;
    let totalInitReward = 0;
    
    for (let i = 0; i < perRoundCount; i++) {
      // 👇 核心修复：循环内检查3个停止条件，任一满足立即跳出
      if (this.stopAllTasks || this.taskLimitReached[taskKey] || this.skippedLowRewardTasks.has(taskKey)) {
        console.log(`📌 账号[${this.nickname}] ${taskConfig.name} 已触发停止条件（停止/达上限/低奖励跳过），跳出初始广告循环`);
        break;
      }
      
      const singleInitResult = await this.executeSingleTaskWithParams(taskKey,
      taskConfig, {
        requestSceneType: 1,
        taskType: 1,
        isInitVersion: true
      });
      
      if (singleInitResult.success) {
        totalInitSuccess++;
        totalInitReward += singleInitResult.reward;
        // 日志合并：只保留1条，含累计+总计
        console.log(` ==>${taskConfig.name}（${i+1}次）执行成功，获得${singleInitResult.reward}金币，累计：${this.totalEarned}，总计：${this.initialCoin + this.totalEarned}`);
      } else {
        console.log(` ==>${taskConfig.name}（${i+1}次）执行失败`);
      }
      
      // 同一任务间隔（环境变量控制）
      const sameTaskDelay = Math.floor(Math.random() * (SAME_TASK_DELAY_MAX - SAME_TASK_DELAY_MIN + 1)) + SAME_TASK_DELAY_MIN;
      await new Promise(resolve => setTimeout(resolve, sameTaskDelay * 1000));
      console.log(`同一任务间隔：${sameTaskDelay}秒（范围${SAME_TASK_DELAY_MIN}-${SAME_TASK_DELAY_MAX}秒）`);
    }
    
    this.taskStats[taskKey].success += totalInitSuccess;
    this.taskStats[taskKey].failed += perRoundCount - totalInitSuccess;
    this.taskStats[taskKey].totalReward += totalInitReward;
    
    return {
      success: totalInitSuccess > 0,
      reward: totalInitReward
    };
  }
  
  // 模式1：先执行1次初始版（修复break错误，用return替代）
  if ([0, 1].includes(this.taskExecMode)) {
    // 已停止/被跳过则直接返回，不执行初始版
    if (this.stopAllTasks || this.skippedLowRewardTasks.has(taskKey)) {
      console.log(`📌 账号[${this.nickname}] ${taskConfig.name} 已触发停止条件（停止/低奖励跳过），跳过初始版广告`);
      return { success: false, reward: 0 };
    }
    initTaskResult = await this.executeSingleTaskWithParams(taskKey, taskConfig, {
      requestSceneType: 1,
      taskType: 1,
      isInitVersion: true
    });
    if (initTaskResult.success) {
      console.log(`✅ ${taskConfig.name}执行成功，获得${initTaskResult.reward}金币，累计：${this.totalEarned}，总计：${this.initialCoin + this.totalEarned}`);
    } else {
      console.log(`⚠️ ${taskConfig.name}初始广告执行失败`);
    }
    
    // 初始→追加广告间隔（环境变量控制）
    const initToFormalDelay = Math.floor(Math.random() * (INIT_TO_FORMAL_DELAY_MAX - INIT_TO_FORMAL_DELAY_MIN + 1)) + INIT_TO_FORMAL_DELAY_MIN;
    await new Promise(resolve => setTimeout(resolve, initToFormalDelay * 1000));
    console.log(`任务切换间隔（初始→追加）：${initToFormalDelay}秒（范围${INIT_TO_FORMAL_DELAY_MIN}-${INIT_TO_FORMAL_DELAY_MAX}秒）`);
  }
  
  // 模式1/2：执行正式版广告（追加广告）
  if ([1, 2].includes(this.taskExecMode)) {
    console.log(`📌开始执行${taskConfig.name}（追加广告），共${perRoundCount}次`);
    for (let i = 0; i < perRoundCount; i++) {
      // 👇 核心修复：循环内检查3个停止条件，任一满足立即跳出
      if (this.stopAllTasks || this.taskLimitReached[taskKey] || this.skippedLowRewardTasks.has(taskKey)) {
        console.log(`📌 账号[${this.nickname}] ${taskConfig.name} 已触发停止条件（停止/达上限/低奖励跳过），跳出追加广告循环`);
        break;
      }
      
      const singleResult = await this.executeSingleTaskWithParams(taskKey, taskConfig, {
        requestSceneType: 7,
        taskType: 2,
        isInitVersion: false
      });
      
      if (singleResult.success) {
        formalTaskResult.success = true;
        formalTaskResult.reward += singleResult.reward;
        // 日志合并：只保留1条，含累计+总计
        console.log(` ==>${taskConfig.name}（追加广告${i+1}次）获得${singleResult.reward}金币，累计：${this.totalEarned}，总计：${this.initialCoin + this.totalEarned}`);
      } else {
        console.log(` ==>${taskConfig.name}（追加广告${i+1}次）执行失败`);
      }
      
      // 同一任务间隔（环境变量控制）
      const sameTaskDelay = Math.floor(Math.random() * (SAME_TASK_DELAY_MAX - SAME_TASK_DELAY_MIN + 1)) + SAME_TASK_DELAY_MIN;
      await new Promise(resolve => setTimeout(resolve, sameTaskDelay * 1000));
      console.log(`同一任务间隔：${sameTaskDelay}秒（范围${SAME_TASK_DELAY_MIN}-${SAME_TASK_DELAY_MAX}秒）`);
    }
  }
  
  // 合并统计结果
  if (this.taskExecMode === 1) {
    this.taskStats[taskKey].success += initTaskResult.success ? 1 : 0;
    this.taskStats[taskKey].failed += initTaskResult.success ? 0 : 1;
    this.taskStats[taskKey].totalReward += initTaskResult.reward;
    
    this.taskStats[taskKey].success += formalTaskResult.success ? perRoundCount : 0;
    this.taskStats[taskKey].failed += formalTaskResult.success ? 0 : perRoundCount;
    this.taskStats[taskKey].totalReward += formalTaskResult.reward;
  }
  
  if (this.taskExecMode === 2) {
    this.taskStats[taskKey].success += formalTaskResult.success ? perRoundCount : 0;
    this.taskStats[taskKey].failed += formalTaskResult.success ? 0 : perRoundCount;
    this.taskStats[taskKey].totalReward += formalTaskResult.reward;
  }
  
  return {
    success: initTaskResult.success || formalTaskResult.success,
    reward: initTaskResult.reward + formalTaskResult.reward
  };
}


/**
 * 按轮次执行所有任务：每轮按顺序执行指定任务
 * @param {string[]} tasksSequence - 任务执行顺序
 * @param {object} countsPerRound - 每轮每任务执行次数
 * @param {number} rounds - 执行轮数
 */
async executeTasksByRounds(tasksSequence, countsPerRound, rounds) {
  // 初始化任务统计和限制状态
  tasksSequence.forEach((k) => {
    if (!this.taskStats[k]) this.taskStats[k] = { success: 0, failed: 0, totalReward: 0 };
    if (this.taskLimitReached[k] === undefined) this.taskLimitReached[k] = false;
    // 初始化任务级低奖励次数
    if (this.taskLowRewardStreak[k] === undefined) this.taskLowRewardStreak[k] = 0;
  });
  
  // 循环执行指定轮次
  for (let round = 1; round <= rounds; round++) {
    if (this.stopAllTasks) {
      console.log(`账号[${this.nickname}] 第${round}轮开始前检测到停止条件，终止后续轮次`);
      break;
    }
    
    // 👇 新增：筛选可执行任务（未达上限+未被低奖励跳过）
    const executableTasks = tasksSequence.filter(taskKey => 
      !this.taskLimitReached[taskKey] && !this.skippedLowRewardTasks.has(taskKey)
    );
    // 无任何可执行任务时停止
    if (executableTasks.length === 0) {
      console.log(`🏁 账号[${this.nickname}] 无任何可执行任务（达上限或低奖励），停止所有轮次执行`);
      this.stopAllTasks = true;
      break;
    }
    
    const allTasksLimited = tasksSequence.every(taskKey => this.taskLimitReached[taskKey]);
    if (allTasksLimited) {
      console.log(`📌 账号[${this.nickname}] 所有任务已达上限，停止所有轮次执行`);
      this.stopAllTasks = true;
      break;
    }
    
    console.log(`\n================================ 账号[${this.nickname}] 第${round}轮开始（执行模式${this.taskExecMode}）=================================`);
    console.log(`本轮按顺序执行任务：${tasksSequence.join(" -> ")}`);
    console.log(`本轮可执行任务：${executableTasks.map(k => this.taskConfigs[k].name).join(" -> ")}`);
    console.log(`暂时跳过的低奖励任务：${Array.from(this.skippedLowRewardTasks).map(k => this.taskConfigs[k].name).join("、") || "无"}`);
    
    // 按顺序执行本轮所有任务
    for (const taskKey of tasksSequence) {
      if (this.stopAllTasks) break;
      if (!this.taskConfigs[taskKey]) {
        console.log(`⚠️ 账号[${this.nickname}] 跳过未知任务 ${taskKey}`);
        continue;
      }
      if (this.taskLimitReached[taskKey]) {
        console.log(`账号[${this.nickname}] ${this.taskConfigs[taskKey].name} 已达上限，跳过`);
        continue;
      }
      // 👇 新增：跳过低奖励标记的任务
      if (this.skippedLowRewardTasks.has(taskKey)) {
        console.log(`账号[${this.nickname}] ${this.taskConfigs[taskKey].name} 因低奖励暂时跳过，切换下一个任务`);
        continue;
      }
      
      // 执行单个任务（根据模式自动适配逻辑）
      await this.executeTask(taskKey);
      
      // 任务切换间隔（环境变量控制）
      const taskBetweenDelay = Math.floor(Math.random() * (TASK_BETWEEN_DELAY_MAX - TASK_BETWEEN_DELAY_MIN + 1)) + TASK_BETWEEN_DELAY_MIN;
      await new Promise(resolve => setTimeout(resolve, taskBetweenDelay * 1000));
      console.log(`任务切换间隔（${taskKey}→下一个任务）：${taskBetweenDelay}秒（范围${TASK_BETWEEN_DELAY_MIN}-${TASK_BETWEEN_DELAY_MAX}秒）`);
    }
    
    // 👇 新增：本轮执行完后，再次检查所有任务是否可执行
    const allTasksUnavailable = tasksSequence.every(taskKey => 
      this.taskLimitReached[taskKey] || this.skippedLowRewardTasks.has(taskKey)
    );
    if (allTasksUnavailable) {
      console.log(`🏁 账号[${this.nickname}] 无任何可执行任务（达上限或低奖励），停止所有轮次执行`);
      this.stopAllTasks = true;
      break;
    }
    
    // 👇 新增：本轮执行完后，再次检查所有任务是否达上限（防止本轮中最后一个任务刚达上限）
    const allTasksLimitedAfterRound = tasksSequence.every(taskKey => this.taskLimitReached[taskKey]);
    if (allTasksLimitedAfterRound) {
      console.log(`📌 账号[${this.nickname}] 所有任务已达上限，停止所有轮次执行`);
      this.stopAllTasks = true;
      break;
    }
    
    // 每轮结束后检查是否只剩look任务且已冷却（加开关判断）
    if (this.enableLookCooldownCheck && this.isOnlyLookTaskAvailable()) {
      const { isCooling } = await this.checkLookTaskCoolDown();
      if (isCooling) {
        console.log(`🏁 账号[${this.nickname}] 只剩look任务且广告处于冷却中，停止所有轮次执行`);
        this.stopAllTasks = true;
        break;
      }
    }
    
    console.log(`================================ 账号[${this.nickname}] 第${round}轮结束 =================================`);
  }
}

}
// ================================= 任务执行入口 =================================
/**
 * 处理单个账号：验证代理、获取账号信息、执行任务
 * @param {object} accountConfig - 账号配置
 * @returns {object} 任务执行结果
 */
async function processAccount(accountConfig) {
  // 代理连通性测试
  if (accountConfig.proxyUrl) {
    console.log(`账号[${accountConfig.index}]${accountConfig.remark ? "（" + accountConfig.remark + "）" : ""} 🔌 测试代理连接中...`);
    const proxyTest = await testProxyConnectivity(
      accountConfig.proxyUrl,
      `账号[${accountConfig.index}]${accountConfig.remark ? "（" + accountConfig.remark + "）" : ""}`
    );
    console.log(`  - ${proxyTest.ok ? "✅ 代理验证通过，IP: " + proxyTest.ip : "❌ 代理验证失败"}: ${proxyTest.msg}`);
    
    // 检测重复代理IP（防封号）
    if (proxyTest.ok && proxyTest.ip && proxyTest.ip !== "localhost") {
      if (usedProxies.has(proxyTest.ip)) {
        console.log(`\n⚠️ 存在相同代理IP（${proxyTest.ip}），请立即检查！`);
        process.exit(1);
      }
      usedProxies.add(proxyTest.ip);
    }
  } else {
    console.log(`账号[${accountConfig.index}]${accountConfig.remark ? "（" + accountConfig.remark + "）" : ""} 未配置代理，走直连`);
  }
  
  // 获取账号初始信息
  console.log(`账号[${accountConfig.index}]${accountConfig.remark ? "（" + accountConfig.remark + "）" : ""} 🔍 获取账号信息中...`);
  let initialAccountInfo = await getAccountBasicInfo(
    accountConfig.cookie,
    accountConfig.proxyUrl,
    accountConfig.index
  );
  let nickname = initialAccountInfo?.nickname || "账号" + accountConfig.index;
  let initialCoin = 0;
  const initialAllCash = initialAccountInfo?.allCash || 0;
  
  if (initialAccountInfo) {
    initialCoin = initialAccountInfo.totalCoin != null ? parseInt(initialAccountInfo.totalCoin) : 0;
    const totalCoinStr = initialAccountInfo.totalCoin != null ? initialAccountInfo.totalCoin : "未知";
    console.log(`账号[${nickname}] ✅ 登录成功，💰 当前金币: ${totalCoinStr}，💸 当前余额: ${initialAllCash}`);
  } else {
    console.log(`账号[${nickname}] ❌ 基本信息获取失败，继续执行任务`);
  }
  
  // 初始化任务实例
  const adTask = new KuaishouAdTask({
    ...accountConfig,
    nickname: nickname,
    tasksToExecute: tasksToExecute,
    initialCoin: initialCoin,
  });
  
  // 检查金币是否超出上限
  await adTask.checkCoinLimit();
  if (adTask.coinExceeded) {
    console.log(`账号[${adTask.nickname}] 初始金币已超过阈值，不执行任务`);
    const finalCoinComputed = initialCoin + (adTask.totalEarned || 0);
    return {
      index: accountConfig.index,
      remark: accountConfig.remark || "无备注",
      nickname: nickname,
      initialCoin: initialCoin,
      finalCoin: finalCoinComputed,
      coinChange: adTask.totalEarned || 0,
      initialCash: initialAllCash,
      finalCash: initialAllCash,
      cashChange: 0,
      stats: adTask.getTaskStats(),
      coinLimitExceeded: true,
      totalEarned: adTask.totalEarned,
    };
  }
  
  // 执行任务（按轮次执行）
  await adTask.executeTasksByRounds(tasksToExecute, TASK_COUNTS, KSROUNDS);
  
  // 计算最终金币（初始金币+累计获得）
  const finalCoinComputed = initialCoin + (adTask.totalEarned || 0);
  adTask.printTaskStats();
  
  return {
    index: accountConfig.index,
    remark: accountConfig.remark || "无备注",
    nickname: nickname,
    initialCoin: initialCoin,
    finalCoin: finalCoinComputed,
    coinChange: adTask.totalEarned || 0,
    initialCash: initialAllCash,
    finalCash: initialAllCash,
    cashChange: 0,
    stats: adTask.getTaskStats(),
    coinLimitExceeded: adTask.coinExceeded,
    totalEarned: adTask.totalEarned,
  };
}
/**
 * 打印任务执行简要汇总
 * @param {object[]} accountResults - 所有账号执行结果
 */
function printSimpleSummary(accountResults) {
  console.log("\n\n================ 任务执行简要汇总（执行模式" + TASK_EXEC_MODE + "） ================\n");
  accountResults.forEach((account) => {
    console.log(`账号[${account.index}] ${account.remark} / ${account.nickname} -> 初始金币: ${account.initialCoin}, 本次累计获得: ${account.totalEarned || 0}, 最终金币: ${account.finalCoin}`);
  });
  console.log("\n================ 汇总结束 ================\n");
}
// ================================= 全局变量初始化 =================================
const accountConfigs = getAccountConfigsFromEnv(); // 账号配置
const accountCount = accountConfigs.length; // 账号数量
const tasksToExecute = getTasksToExecute(); // 要执行的任务列表
const TASK_COUNTS = parseTaskCounts(); // 每轮每任务执行次数
const usedProxies = new Set(); // 已使用的代理IP（防重复）
// ================================= 程序入口 =================================
(async () => {
  console.log("================================================================================");
  console.log("================🎉 系统初始化完成，启动成功！🎉");
  console.log("💎 检测到环境变量配置：" + accountCount + "个账号");
  console.log("🎯 将执行以下任务：" + tasksToExecute.join(", "));
  console.log(`🎯 配置参数：轮数=${KSROUNDS}, 金币上限=${KSCOIN_LIMIT}, 低奖励阈值=${KSLOW_REWARD_THRESHOLD}, 连续低奖励上限=${KSLOW_REWARD_LIMIT}`);
  console.log(`🎯 look任务冷却检测：${ENABLE_LOOK_COOLDOWN_CHECK ? "✅ 启用" : "❌ 禁用"}（可通过ENABLE_LOOK_COOLDOWN_CHECK=0/1切换）`);
  console.log(`🎯 执行模式：${TASK_EXEC_MODE}（0=只初始，1=先初始后追加，2=只追加）`);
  console.log(`🎯 并发配置：最大并发账号数=${MAX_CONCURRENCY}`);
  console.log(`🎯 等待时间配置：同一任务${SAME_TASK_DELAY_MIN}-${SAME_TASK_DELAY_MAX}秒，任务切换${TASK_BETWEEN_DELAY_MIN}-${TASK_BETWEEN_DELAY_MAX}秒`);
  console.log(`🎯 观看时间配置：look任务${LOOK_WATCH_SECONDS_MIN}-${LOOK_WATCH_SECONDS_MAX}秒，其他任务${GLOBAL_WATCH_SECONDS_MIN}-${GLOBAL_WATCH_SECONDS_MAX}秒`);
   console.log("================================================================================");
  
  // 检查账号数量是否超出最大并发限制
  if (accountCount > MAX_CONCURRENCY) {
    console.log(`错误: 检测到 ${accountCount} 个账号配置，最多只允许${MAX_CONCURRENCY}个账号并发执行`);
    process.exit(1);
  }
  
  // 加载所有有效账号
  const accounts = loadAccountsFromEnv();
  console.log(`共找到 ${accounts.length} 个有效账号`);
  if (!accounts.length) {
    console.log("未找到有效账号，程序退出");
    process.exit(1);
  }
  
  // 并发执行所有账号任务
  const results = [];
  await concurrentExecute(accounts, MAX_CONCURRENCY, async (account) => {
    console.log(`\n—— 🚀 开始处理账号[${account.index}]${account.remark ? "（" + account.remark + "）" : ""} ——`);
    try {
      const result = await processAccount(account);
      results.push({
        index: account.index,
        remark: account.remark || "无备注",
        nickname: result?.nickname || `账号${account.index}`,
        initialCoin: result?.initialCoin || 0,
        finalCoin: result?.finalCoin || 0,
        coinChange: result?.coinChange || 0,
        initialCash: result?.initialCash || 0,
        finalCash: result?.finalCash || 0,
        cashChange: result?.cashChange || 0,
        stats: result?.stats || {},
        coinLimitExceeded: result?.coinLimitExceeded || false,
        totalEarned: result?.totalEarned || 0,
      });
    } catch (error) {
      console.log(`账号[${account.index}]${account.remark ? "（" + account.remark + "）" : ""} ❌ 执行异常：${error.message}`);
      results.push({
        index: account.index,
        remark: account.remark || "无备注",
        nickname: `账号${account.index}`,
        initialCoin: 0,
        finalCoin: 0,
        coinChange: 0,
        initialCash: 0,
        finalCash: 0,
        cashChange: 0,
        error: error.message,
        totalEarned: 0,
      });
    }
  });
  
  // 按账号索引排序并打印汇总
  results.sort((a, b) => a.index - b.index);
  console.log("\n---------------------------------------------- 所有账号执行完成 ----------------------------------------------");
  printSimpleSummary(results);
  process.exit(0);
})();
