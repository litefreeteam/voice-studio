/* User-facing scene names and defaults. The existing catalog remains the source of voices. */
(function (root) {
  const scenes = [
    { id: 'knowledge-video', name: '短视频配音', description: '科普、测评、解说，让画面有声有色。', icon: 'video', image: 'short-video-apricot', tag: '清晰有活力', keywords: '视频 口播 抖音 小红书 B站 科普 测评 解说', featured: true },
    { id: 'interview-dialogue', name: '双人播客', description: '主持人与嘉宾，一来一往自然开聊。', icon: 'headphones', image: 'podcast-mint', tag: '双人对谈', keywords: '播客 podcast 访谈 采访 问答 对谈', categories: ['content'], featured: true },
    { id: 'game-dialogue', name: '游戏角色配音', description: '为 NPC、剧情和任务，赋予不同声音。', icon: 'gamepad-2', image: 'game', tag: '多角色对白', keywords: '游戏 NPC RPG 角色 剧情 台词 对白', featured: true },
    { id: 'children-reading', name: '儿童绘本', description: '温柔旁白搭配童声，把故事讲得生动。', icon: 'book-open', image: 'picture-book', tag: '旁白 + 童声', keywords: '儿童 绘本 童话 亲子 读书 故事', featured: true, defaults: { pace: 'slow', intensity: 35, instruction: '像陪孩子读绘本，旁白温柔，人物对白生动，吐字清楚，每句之间自然停顿。' } },
    { id: 'course-batch', name: '讲课与课件', description: 'PPT、网课逐段讲解，批量配好每一课。', icon: 'graduation-cap', image: 'course', tag: '按段批量配音', keywords: '讲课 课件 PPT 网课 课程 教学 教育 老师 知识付费', featured: true },
    { id: 'audiobook', name: '有声书朗读', description: '小说、散文与长篇故事，娓娓道来。', icon: 'book-open', image: 'audiobook', tag: '沉浸式讲述', keywords: '有声书 小说 听书 散文 长篇 阅读 朗读', featured: true, defaults: { instruction: '保持叙述声线稳定，按情节自然表达，段落结尾稍作停顿，避免夸张的播音腔。' } },
    { id: 'ecommerce', image: 'ecommerce', name: '带货口播', description: '好物种草，清楚讲出产品卖点。', icon: 'megaphone', keywords: '带货 电商 商品 好物 种草 推广 直播 口播' },
    { id: 'brand-ad', image: 'brand-ad', name: '品牌广告', description: '自信有分量的品牌与宣传片旁白。', icon: 'sparkles', keywords: '品牌 广告 宣传片 营销 商业 企业介绍' },
    { id: 'tutorial-software', image: 'tutorial-software', name: '操作教程', description: '一步一段，听着就能跟着做。', icon: 'sliders-horizontal', keywords: '操作 教程 软件 使用说明 录屏 演示 步骤' },
    { id: 'training-onboarding', image: 'training-onboarding', name: '企业培训', description: '入职培训、流程规范，逐段讲清。', icon: 'graduation-cap', keywords: '企业 培训 新员工 入职 内训 规范 流程' },
    { id: 'bedtime-story', image: 'bedtime-story', name: '睡前故事', description: '轻柔慢讲，陪伴安静的晚间时光。', icon: 'moon', keywords: '睡前 故事 晚安 哄睡 儿童 陪伴', defaults: { intensity: 30 } },
    { id: 'language-lesson', image: 'language-lesson', name: '英语跟读', description: '英语原生音色，逐句听、逐句练。', icon: 'message-circle', keywords: '英语 English 外语 口语 发音 跟读 学习' },
    { id: 'documentary', image: 'documentary', name: '纪录片旁白', description: '从容讲述城市、人物与自然。', icon: 'video', keywords: '纪录片 人文 城市 自然 历史 旁白 解说' },
    { id: 'travel-vlog', image: 'travel-vlog', name: '旅行 Vlog', description: '生活记录，用声音留住旅途温度。', icon: 'video', keywords: '旅行 Vlog 生活 记录 日常 游记 视频' },
    { id: 'product-demo', image: 'product-demo', name: '产品说明', description: '用途、安装与使用细节，清晰易懂。', icon: 'volume-2', keywords: '产品 说明 安装 使用 手册 功能 演示' },
    { id: 'service-guide', image: 'service-guide', name: '客服与通知', description: '服务引导、流程提醒，礼貌又清楚。', icon: 'headset', keywords: '客服 通知 播报 提示 电话 引导 门店 广播' },
    { id: 'knowledge-lesson', image: 'knowledge-lesson', name: '知识微课', description: '概念加例子，把知识讲得好理解。', icon: 'graduation-cap', keywords: '知识 微课 短课 课堂 概念 科普' },
    { id: 'exam-review', image: 'exam-review', name: '考点复习', description: '突出重点，制作随时能听的复习稿。', icon: 'book-open', keywords: '考点 复习 考试 备考 学习 记忆 背诵' },
    { id: 'podcast-intro', image: 'podcast-intro', name: '播客开场', description: '一个人的声音，也能自然打开话题。', icon: 'mic', keywords: '播客 开场 单人 podcast 音频 主持 电台' },
    { id: 'relaxation', image: 'relaxation', name: '冥想与放松', description: '舒缓的声音，带着节奏慢慢放松。', icon: 'heart', keywords: '冥想 放松 舒缓 呼吸 疗愈 陪伴', defaults: { instruction: '轻声、舒缓地引导，给听众留下自然呼吸和感受的时间，避免催促。' } }
  ];
  const searchAliases = {
    ecommerce: ['门店促销', '店铺促销', '超市促销', '餐饮促销', '打折', '优惠活动', '叫卖', '开业', '探店'],
    'brand-ad': ['门店促销', '房地产', '房产', '卖房', '楼盘介绍', '楼盘推广', '商铺', '招商'],
    'course-batch': ['老师备课', '教学目标', '课件配音', '教案', '培训课件', 'pptx', 'word', 'docx'],
    audiobook: ['网文', '网络小说', '小说对白', '有声小说'],
    'service-guide': ['店内广播', '商场广播', '医院叫号', '前台通知']
  };
  function template(catalog, id) {
    const scene = scenes.find(scene => scene.id === id), source = catalog.templates.find(template => template.id === id);
    if (!scene || !source) throw new Error('暂时找不到这个创作场景');
    return { ...structuredClone(source), ...scene.defaults, name: scene.name };
  }
  function filter(catalog, category = 'all', query = '') {
    const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    return scenes.filter(scene => {
      const source = catalog.templates.find(template => template.id === scene.id);
      if (!source || category !== 'all' && source.category !== category && !scene.categories?.includes(category)) return false;
      const categoryName = catalog.templateCategories.find(group => group.id === source.category)?.name || '';
      const text = normalize(`${scene.name} ${scene.description} ${scene.keywords} ${source.name} ${categoryName} ${(searchAliases[scene.id] || []).join(' ')}`);
      return terms.every(term => text.includes(term));
    });
  }
  function suggestions(catalog, category, query) {
    const pieces = String(query).normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]{2}|[a-z0-9]+/gu) || [];
    return filter(catalog, category).map(scene => ({ scene, score: pieces.filter(piece => filter(catalog, category, piece).includes(scene)).length }))
      .filter(item => item.score).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.scene);
  }
  const api = { scenes, template, filter, suggestions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeScenarios = api;
})(typeof window === 'undefined' ? globalThis : window);
