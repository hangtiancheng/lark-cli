const spinnerVerbs = [
  "Accomplishing", // 完成
  "Architecting", // 架构设计
  "Baking", // 烘焙
  "Be-bopping'", // 即兴爵士
  "Befuddling", // 迷惑
  "Boogieing", // 跳布吉舞
  "Boondoggling", // 做无用功
  "Bootstrapping", // 自举启动
  "Brewing", // 酿造
  "Calculating", // 计算
  "Canoodling", // 亲热搂抱
  "Caramelizing", // 焦糖化
  "Cascading", // 级联
  "Cerebrating", // 思考
  "Choreographing", // 编舞
  "Churning", // 搅拌
  "Coalescing", // 聚合
  "Cogitating", // 深思熟虑
  "Combobulating", // 整理妥当
  "Composing", // 作曲
  "Computing", // 运算
  "Concocting", // 炮制
  "Considering", // 考虑
  "Contemplating", // 冥想
  "Cooking", // 烹饪
  "Crafting", // 手作
  "Creating", // 创造
  "Crunching", // 嘎吱碾压
  "Crystallizing", // 结晶化
  "Cultivating", // 培育
  "Deciphering", // 破译
  "Deliberating", // 审议
  "Dilly-dallying", // 磨蹭
  "Discombobulating", // 使混乱
  "Doodling", // 涂鸦
  "Elucidating", // 阐明
  "Enchanting", // 施加魅惑
  "Envisioning", // 展望
  "Fermenting", // 发酵
  "Finagling", // 耍花招
  "Flambéing", // 法式火焰烹饪
  "Flummoxing", // 使困惑
  "Forging", // 锻造
  "Frolicking", // 嬉戏
  "Gallivanting", // 闲逛
  "Garnishing", // 点缀
  "Generating", // 生成
  "Germinating", // 萌芽
  "Grooving", // 沉浸
  "Harmonizing", // 和谐
  "Hatching", // 孵化
  "Honking", // 鸣笛
  "Ideating", // 构思
  "Imagining", // 想象
  "Improvising", // 即兴创作
  "Incubating", // 孵化
  "Inferring", // 推断
  "Infusing", // 浸泡
  "Kneading", // 揉捏
  "Lollygagging", // 游手好闲
  "Manifesting", // 显化
  "Marinating", // 腌制
  "Meandering", // 蜿蜒
  "Metamorphosing", // 蜕变
  "Mewing", // 喵叫
  "Moonwalking", // 太空步
  "Moseying", // 溜达
  "Mulling", // 琢磨
  "Musing", // 沉吟
  "Noodling", // 瞎捣鼓
  "Orbiting", // 绕轨道运行
  "Orchestrating", // 编排
  "Percolating", // 渗透过滤
  "Philosophizing", // 哲学思辨
  "Pondering", // 权衡
  "Pontificating", // 妄下定论
  "Pouncing", // 猛扑
  "Purring", // 呼噜
  "Puzzling", // 苦苦思索
  "Razzle-dazzling", // 花哨
  "Ruminating", // 深思熟虑
  "Scampering", // 蹦跳
  "Simmering", // 慢炖
  "Sketching", // 素描
  "Spelunking", // 洞穴探险
  "Spinning", // 旋转
  "Sprouting", // 抽芽
  "Synthesizing", // 综合
  "Thinking", // 思考
  "Tinkering", // 捣鼓修补
  "Transfiguring", // 使改观
  "Transmuting", // 使变质
  "Undulating", // 波涛起伏
  "Unfurling", // 展开
  "Unravelling", // 拆解
  "Vibing", // 享受氛围
  "Wandering", // 漫步
  "Whisking", // 搅拌
  "Working", // 工作
  "Wrangling", // 费劲处理
  "Zigzagging", // 之字形前进
];

export function randomVerb(): string {
  return spinnerVerbs[Math.floor(Math.random() * spinnerVerbs.length)];
}

const completionVerbs = [
  "Accomplished", // 已达成
  "Baked", // 已烘焙
  "Brewed", // 已酿造
  "Cooked", // 已烹饪
  "Crafted", // 已手作
  "Crunched", // 已碾压处理
  "Forged", // 已锻造
  "Hatched", // 已孵化
  "Pondered", // 已深思熟虑
  "Synthesized", // 已综合
  "Tinkered", // 已捣鼓修补
  "Worked", // 已完成
  "Wrangled", // 已搞定
  "Computed", // 已运算
  "Created", // 已创造
  "Composed", // 已作曲
  "Conjured", // 已变出
  "Concocted", // 已炮制
  "Cultivated", // 已培育
  "Deciphered", // 已破译
];

export function randomCompletionVerb(): string {
  return completionVerbs[Math.floor(Math.random() * completionVerbs.length)];
}
