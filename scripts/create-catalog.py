"""Build the versioned product catalogue from supported upstream capabilities."""
import json
from pathlib import Path

voices = [
    ("Vivian", "知夏", "female", "明亮清透", "中文", "Chinese", "青音"),
    ("Serena", "温宁", "female", "温暖柔和", "中文", "Chinese", "青音"),
    ("Uncle_Fu", "远山", "male", "低沉醇厚", "中文", "Chinese", "成熟"),
    ("Dylan", "景川", "male", "清朗自然 · 北京口音", "中文", "Chinese", "青音"),
    ("Eric", "阿成", "male", "随和鲜活 · 四川口音", "中文", "Chinese", "青音"),
    ("Ryan", "莱恩", "male", "节奏鲜明 · 美式英语", "英语", "English", "成熟"),
    ("Aiden", "艾登", "male", "阳光清晰 · 美式英语", "英语", "English", "青音"),
    ("Ono_Anna", "杏奈", "female", "轻盈灵动 · 日语", "日语", "Japanese", "青音"),
    ("Sohee", "素熙", "female", "温柔细腻 · 韩语", "韩语", "Korean", "青音"),
]
characters = [
    ("boy-clear", "乐乐", "child", "清亮男童", "7至10岁男童的声音，清亮、干净、有童真，发音自然清楚，避免成人低音和夸张卡通腔。"),
    ("girl-clear", "小雨", "child", "灵动女童", "7至10岁女童的声音，清脆、灵动、有童真，发音自然，避免成人性感或成熟声线。"),
    ("boy-soft", "豆豆", "child", "软萌男童", "4至6岁小男孩的声音，稚嫩、柔软、自然，有儿童说话的节奏，但不要含糊不清。"),
    ("girl-soft", "果果", "child", "甜亮女童", "4至6岁小女孩的声音，稚嫩、轻柔、明亮，像自然讲话的小朋友，避免过度夸张。"),
    ("grandpa", "松爷爷", "elder", "慈祥爷爷", "七十岁左右男性，温暖慈祥，嗓音稍沙哑，有岁月感但吐字清楚，自然交流。"),
    ("grandma", "林奶奶", "elder", "温柔奶奶", "七十岁左右女性，慈祥温柔，略带气声，语速从容，有真实老年人的声线。"),
    ("story-male", "墨白", "male", "沉稳叙事", "三十岁左右成年男性，沉稳、清晰、富有叙事感，低中音，像讲述故事而不是播新闻。"),
    ("story-female", "听澜", "female", "温柔讲述", "三十岁左右成年女性，温柔、清晰、有感染力，声音舒展，像与听众分享故事。"),
    ("hero", "陆沉", "male", "游戏主角", "成年男性游戏角色，坚定、干练、自然，中低音，保留真实口语感，不要过度戏剧化。"),
    ("heroine", "星遥", "female", "冒险女主", "成年女性冒险角色，清晰、自信、敏捷，声线明亮有力量，保持自然对话感。"),
    ("mascot", "团团", "cartoon", "活泼萌宠", "虚构卡通吉祥物，轻快、明亮、圆润、亲切，发音清楚，带轻微卡通感，不模仿任何已有角色。"),
    ("robot", "小智", "cartoon", "友好机器人", "虚构机器人助手，中性声线，清晰、平稳、友好，带适度机械节奏，但不要失去自然可懂度。"),
]
emotions = [
    ("natural", "自然", "自然口语，像面对面交流，避免播音腔。"),
    ("happy", "开心", "开心、轻快，喜悦自然流露，不夸张。"),
    ("excited", "激动", "激动、有活力，节奏鲜明但吐字清楚。"),
    ("gentle", "温柔", "温柔、亲近、平和，语气柔软。"),
    ("calm", "平静", "平静从容，语气稳定、舒展。"),
    ("sad", "难过", "低落、难过，克制情绪，略有哽咽。"),
    ("melancholy", "惆怅", "若有所思，惆怅、略带遗憾，情感克制。"),
    ("angry", "生气", "克制着愤怒，语气坚定有力，避免持续喊叫。"),
    ("afraid", "害怕", "害怕、急切，略带颤音，避免持续尖叫。"),
    ("nervous", "紧张", "紧张、有些不安，短促但表达清楚。"),
    ("urgent", "紧迫", "情况紧迫，稍大声，短促有力地催促行动。"),
    ("surprised", "惊讶", "突然惊讶，带不敢相信的感觉，不夸张。"),
    ("relief", "释然", "松了一口气，感激中仍带轻微紧张。"),
    ("hopeful", "期待", "满怀希望和期待，声音自然上扬。"),
    ("doubtful", "疑惑", "疑惑、试探，像在认真询问。"),
    ("firm", "坚定", "坚定、自信、有说服力，清楚有力。"),
    ("tired", "疲惫", "疲惫、气息稍弱，保持清晰可懂。"),
    ("whisper", "轻声", "低声、轻柔地说，像靠近身边的人交谈。"),
]
scenes = [
    ("dialogue", "自然对话", "像真实场景中的对话，口语自然。"),
    ("game", "游戏角色", "正在游戏剧情中与同伴说话，带情境感。"),
    ("story", "故事旁白", "有画面感地讲述故事，情绪随语义自然变化。"),
    ("video", "短视频解说", "节奏清楚，讲解亲切有重点，避免机械朗读。"),
    ("course", "课程讲解", "讲解清晰耐心，关键处有自然重音。"),
    ("ad", "品牌广告", "自信、清晰、有感染力，像真诚推荐。"),
    ("service", "客服提示", "礼貌、耐心、清晰，语气友好。"),
    ("bedtime", "睡前故事", "轻柔、舒缓地讲故事，节奏从容。"),
]
catalog = {
    "voices": [dict(zip(["id", "name", "gender", "description", "native", "language", "age"], row)) for row in voices],
    "characters": [dict(zip(["id", "name", "gender", "description", "prompt"], row)) for row in characters],
    "emotions": [dict(zip(["id", "name", "prompt"], row)) for row in emotions],
    "scenes": [dict(zip(["id", "name", "prompt"], row)) for row in scenes],
    "languages": [{"id": key, "name": name} for key, name in [
        ("Chinese", "中文"), ("English", "英语"), ("Japanese", "日语"), ("Korean", "韩语"),
        ("German", "德语"), ("French", "法语"), ("Russian", "俄语"), ("Portuguese", "葡萄牙语"),
        ("Spanish", "西班牙语"), ("Italian", "意大利语")]],
}
destination = Path(__file__).resolve().parents[1] / "shared/catalog.json"
# Keep recorded metadata, expanded presets and templates when refreshing legacy entries.
if destination.exists():
    existing = json.loads(destination.read_text("utf-8"))
    for key, rows in catalog.items():
        retained = {row["id"]: row for row in existing.get(key, [])}
        catalog[key] = [{**row, **retained.get(row["id"], {})} for row in rows]
        catalog[key].extend(row for row in existing.get(key, []) if row["id"] not in {item["id"] for item in rows})
    catalog.update({key: value for key, value in existing.items() if key not in catalog})
destination.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", "utf-8")
