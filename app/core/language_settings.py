"""
Language preference persistence and translation helpers.

Code version: v0.6.1
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from app.core.config import SETTINGS_STORE_DIR
from app.core.settings_store import LEGACY_SECTION_PATHS, load_settings_section, save_settings_section

LanguageCode = Literal["en", "zh_hant_hk", "zh_hans_cn"]

LANGUAGE_SETTINGS_PATH = SETTINGS_STORE_DIR / "language.json"
LEGACY_SECTION_PATHS["language"] = LANGUAGE_SETTINGS_PATH

DEFAULT_LANGUAGE_CODE: LanguageCode = "en"
SUPPORTED_LANGUAGE_CODES: tuple[LanguageCode, ...] = ("en", "zh_hant_hk", "zh_hans_cn")
LANGUAGE_LABELS: dict[LanguageCode, str] = {
    "en": "English",
    "zh_hant_hk": "繁體中文（香港）",
    "zh_hans_cn": "简体中文(中国大陆)",
}
HTML_LANG_BY_LANGUAGE: dict[LanguageCode, str] = {
    "en": "en-US",
    "zh_hant_hk": "zh-HK",
    "zh_hans_cn": "zh-CN",
}

DEFAULT_TRANSLATION_ROWS: tuple[dict[str, str], ...] = (
    {'en': 'Compare securities, research strategies, and review your investments in one local-first workspace.', 'zh_hant_hk': '在本機優先的工作區比較證券、研究策略及檢視投資。', 'zh_hans_cn': '在本地优先的工作区比较证券、研究策略并查看投资。'},
    {'en': 'Explore price history, portfolios, backtests, and Bayesian or LSTM forecasts. Review imported broker records and use optional protected Longbridge trading. IBKR supports file imports only.', 'zh_hant_hk': '探索歷史價格、投資組合、回測及貝葉斯或 LSTM 預測。檢視匯入的券商紀錄，並選用受保護的 Longbridge 交易。IBKR 僅支援檔案匯入。', 'zh_hans_cn': '探索历史价格、投资组合、回测及贝叶斯或 LSTM 预测。查看导入的券商记录，并选用受保护的 Longbridge 交易。IBKR 仅支持文件导入。'},
    {'en': 'Research only. Outputs are general information, not personalized investment, legal, or tax advice, a recommendation, or an offer to trade. They do not assess your objectives, finances, or risk tolerance. Seek qualified independent advice.', 'zh_hant_hk': '僅供研究。輸出為一般資訊，並非個人化投資、法律或稅務意見、推薦或交易要約，不會評估你的目標、財務狀況或風險承受能力。請尋求合資格的獨立專業意見。', 'zh_hans_cn': '仅供研究。输出为一般信息，并非个性化投资、法律或税务建议、推荐或交易要约，不会评估你的目标、财务状况或风险承受能力。请寻求合格的独立专业意见。'},
    {'en': 'Simulations are hypothetical. Backtests, optimized strategies, and model forecasts are not actual trading results or promises. Hindsight, overfitting, data gaps, and assumptions about fills, liquidity, fees, taxes, and corporate actions can materially distort results. Estimated probabilities can be wrong.', 'zh_hant_hk': '模擬屬假設結果。回測、最佳化策略及模型預測並非實際交易績效或承諾。事後偏差、過度擬合、資料缺漏及成交、流動性、費用、稅項和公司行動假設可嚴重扭曲結果。估計機率可能錯誤。', 'zh_hans_cn': '模拟属于假设结果。回测、优化策略及模型预测并非实际交易业绩或承诺。事后偏差、过拟合、数据缺漏及成交、流动性、费用、税项和公司行动假设可能严重扭曲结果。估计概率可能错误。'},
    {'en': 'You can lose money. Past performance does not predict future results. Securities and cash-equivalent classifications do not guarantee safety or liquidity; leverage and margin can produce losses greater than your initial investment.', 'zh_hant_hk': '你可能損失資金。過往績效不能預測未來結果。證券及現金等價物分類不保證安全或流動性；槓桿及孖展可能造成超過初始投資的損失。', 'zh_hans_cn': '你可能损失资金。过往业绩不能预测未来结果。证券及现金等价物分类不保证安全或流动性；杠杆及保证金交易可能造成超过初始投资的损失。'},
    {'en': 'Verify the source. Third-party data, cached prices, imported records, valuations, and calculations may be delayed, incomplete, or incorrect. Reconcile with official broker statements and current market information before relying on an output or filing taxes.', 'zh_hant_hk': '請核實來源。第三方資料、快取價格、匯入紀錄、估值及計算可能延遲、不完整或有誤。依賴輸出或報稅前，請與正式券商結單及最新市場資訊核對。', 'zh_hans_cn': '请核实来源。第三方数据、缓存价格、导入记录、估值及计算可能延迟、不完整或有误。依赖输出或报税前，请与正式券商对账单及最新市场信息核对。'},
    {'en': 'Live trading uses real money. Review the account, instrument, side, quantity, price, and order status before authorizing an order. Software, network, or broker failures can delay, reject, or duplicate requests. A submitted request is not confirmation of execution; verify fills with your broker.', 'zh_hant_hk': '實盤交易涉及真實資金。授權訂單前，請核對帳戶、商品、買賣方向、數量、價格及訂單狀態。軟體、網絡或券商故障可能延遲、拒絕或重複請求。提交請求不代表已成交；請向券商核實成交。', 'zh_hans_cn': '实盘交易涉及真实资金。授权订单前，请核对账户、标的、买卖方向、数量、价格及订单状态。软件、网络或券商故障可能延迟、拒绝或重复请求。提交请求不代表已成交；请向券商核实成交。'},
    {'en': 'Availability and legal rights. The software and information are provided as is and as available, without warranties to the extent permitted by applicable law. No uninterrupted service, accuracy, or investment outcome is guaranteed. Nothing in this notice waives nonwaivable rights or excludes liability that applicable law does not allow to be excluded.', 'zh_hant_hk': '可用性及法律權利。軟體及資訊按現狀及可用情況提供，在適用法律允許的範圍內不提供保證。不保證服務不中斷、資料準確或任何投資結果。本聲明不放棄不可放棄的權利，亦不排除適用法律禁止排除的責任。', 'zh_hans_cn': '可用性及法律权利。软件及信息按现状及可用情况提供，在适用法律允许的范围内不提供保证。不保证服务不中断、数据准确或任何投资结果。本声明不放弃不可放弃的权利，也不排除适用法律禁止排除的责任。'},
    {'en': 'Restore the default Light and Dark palettes in this browser.', 'zh_hant_hk': '還原此瀏覽器的預設淺色與深色配色。', 'zh_hans_cn': '恢复此浏览器的默认浅色与深色配色。'},
    {'en': 'Connection details', 'zh_hant_hk': '連線詳情', 'zh_hans_cn': '连接详情'},
    {"en": "About", "zh_hant_hk": "關於", "zh_hans_cn": "关于"},
    {"en": "Appearance", "zh_hant_hk": "外觀", "zh_hans_cn": "外观"},
    {"en": "Backtest", "zh_hant_hk": "回測", "zh_hans_cn": "回测"},
    {"en": "Broker access", "zh_hant_hk": "券商存取", "zh_hans_cn": "券商访问"},
    {"en": "Cash equivalents", "zh_hant_hk": "現金等價物", "zh_hans_cn": "现金等价物"},
    {"en": "Change", "zh_hant_hk": "變更", "zh_hans_cn": "变更"},
    {"en": "Color token groups", "zh_hant_hk": "色彩權杖分組", "zh_hans_cn": "色彩令牌分组"},
    {"en": "Color tokens", "zh_hant_hk": "色彩權杖", "zh_hans_cn": "色彩令牌"},
    {"en": "Choose the date styles used across long-form and compact displays throughout the workspace.", "zh_hant_hk": "選擇工作區長格式與緊湊顯示使用的日期樣式。", "zh_hans_cn": "选择工作区长格式与紧凑显示使用的日期样式。"},
    {"en": "Choose whether the interface follows your system appearance or stays locked to Light or Dark mode.", "zh_hant_hk": "選擇介面跟隨系統外觀，或固定為淺色或深色模式。", "zh_hans_cn": "选择界面跟随系统外观，或固定为浅色或深色模式。"},
    {"en": "Clear caches", "zh_hant_hk": "清除快取", "zh_hans_cn": "清除缓存"},
    {"en": "Compact", "zh_hant_hk": "短格式", "zh_hans_cn": "短格式"},
    {"en": "Compact date format", "zh_hant_hk": "短格式日期格式", "zh_hans_cn": "短格式日期格式"},
    {"en": "Compute your portfolio", "zh_hant_hk": "計算你的投資組合", "zh_hans_cn": "计算你的投资组合"},
    {"en": "Current", "zh_hant_hk": "目前", "zh_hans_cn": "当前"},
    {"en": "color", "zh_hant_hk": "色彩", "zh_hans_cn": "颜色"},
    {"en": "color picker", "zh_hant_hk": "色彩選擇器", "zh_hans_cn": "取色器"},
    {"en": "Day is always zero-padded, such as 08 Dec 2026.", "zh_hant_hk": "日期固定以補零顯示，例如 08 Dec 2026。", "zh_hans_cn": "日期固定以补零显示，例如 08 Dec 2026。"},
    {"en": "Date format", "zh_hant_hk": "日期格式", "zh_hans_cn": "日期格式"},
    {"en": "Dark", "zh_hant_hk": "深色", "zh_hans_cn": "深色"},
    {"en": "Dollar-cost averaging", "zh_hant_hk": "定期定額", "zh_hans_cn": "定投"},
    {"en": "Download i18n mapping", "zh_hant_hk": "下載 i18n 對照表", "zh_hans_cn": "下载 i18n 映射表"},
    {"en": "East Asian full numeric format, such as 2026年06月01日.", "zh_hant_hk": "東亞完整數字格式，例如 2026年06月01日。", "zh_hans_cn": "东亚完整数字格式，例如 2026年06月01日。"},
    {"en": "East Asian ordering with zero-padded day, such as 2026 Dec 08.", "zh_hant_hk": "東亞日期排序並以補零顯示日期，例如 2026 Dec 08。", "zh_hans_cn": "东亚日期排序并以补零显示日期，例如 2026 Dec 08。"},
    {"en": "East Asian ordering without day padding, such as 2026 Dec 8.", "zh_hant_hk": "東亞日期排序且日期不補零，例如 2026 Dec 8。", "zh_hans_cn": "东亚日期排序且日期不补零，例如 2026 Dec 8。"},
    {"en": "Email (SMTP)", "zh_hant_hk": "電郵（SMTP）", "zh_hans_cn": "电子邮件（SMTP）"},
    {"en": "English", "zh_hant_hk": "English", "zh_hans_cn": "English"},
    {"en": "Export images", "zh_hant_hk": "匯出圖片", "zh_hans_cn": "导出图片"},
    {"en": "Follow your operating system appearance automatically, including live switching when the system changes.", "zh_hant_hk": "自動跟隨作業系統外觀，並在系統變更時即時切換。", "zh_hans_cn": "自动跟随操作系统外观，并在系统变更时实时切换。"},
    {"en": "Font tokens", "zh_hant_hk": "字型權杖", "zh_hans_cn": "字体令牌"},
    {"en": "Force the interface to stay in the bright palette, regardless of the system setting.", "zh_hant_hk": "無論系統設定如何，都讓介面保持明亮配色。", "zh_hans_cn": "无论系统设置如何，都让界面保持明亮配色。"},
    {"en": "Force the interface to stay in the dark palette for lower glare and better nighttime use.", "zh_hant_hk": "讓介面保持深色配色，以降低眩光並改善夜間使用。", "zh_hans_cn": "让界面保持深色配色，以降低眩光并改善夜间使用。"},
    {"en": "Full", "zh_hant_hk": "完整", "zh_hans_cn": "完整"},
    {"en": "Full date format", "zh_hant_hk": "完整日期格式", "zh_hans_cn": "完整日期格式"},
    {"en": "History", "zh_hant_hk": "歷史", "zh_hans_cn": "历史"},
    {"en": "General", "zh_hant_hk": "一般", "zh_hans_cn": "通用"},
    {"en": "Language", "zh_hant_hk": "語言", "zh_hans_cn": "语言"},
    {"en": "Language mapping file actions", "zh_hant_hk": "語言對照表檔案操作", "zh_hans_cn": "语言映射文件操作"},
    {"en": "Language mapping history", "zh_hant_hk": "語言對照表歷史記錄", "zh_hans_cn": "语言映射历史记录"},
    {"en": "Language mapping pages", "zh_hant_hk": "語言對照表頁面", "zh_hans_cn": "语言映射页面"},
    {"en": "Light", "zh_hant_hk": "淺色", "zh_hans_cn": "浅色"},
    {"en": "Local market store", "zh_hant_hk": "本機市場資料庫", "zh_hans_cn": "本地市场数据库"},
    {"en": "Material tokens", "zh_hant_hk": "材質權杖", "zh_hans_cn": "材质令牌"},
    {"en": "Trade", "zh_hant_hk": "交易", "zh_hans_cn": "交易"},
    {"en": "Network self-check", "zh_hant_hk": "網絡自檢", "zh_hans_cn": "网络自检"},
    {"en": "No.", "zh_hant_hk": "序號", "zh_hans_cn": "序号"},
    {"en": "No language mapping changes recorded yet.", "zh_hant_hk": "尚未記錄任何語言對照表變更。", "zh_hans_cn": "尚未记录任何语言映射变更。"},
    {"en": "Palette", "zh_hant_hk": "調色板", "zh_hans_cn": "调色板"},
    {"en": "Reset", "zh_hant_hk": "重設", "zh_hans_cn": "重置"},
    {"en": "Reset all color overrides", "zh_hant_hk": "重設所有色彩覆寫", "zh_hans_cn": "重置所有色彩覆盖"},
    {"en": "Save translations", "zh_hant_hk": "儲存翻譯", "zh_hans_cn": "保存翻译"},
    {"en": "Saving...", "zh_hant_hk": "儲存中…", "zh_hans_cn": "保存中…"},
    {"en": "Saving translations...", "zh_hant_hk": "正在儲存翻譯…", "zh_hans_cn": "正在保存翻译…"},
    {"en": "Single-digit day without leading zero, such as 8 Dec 2026.", "zh_hant_hk": "日期不補零，例如 8 Dec 2026。", "zh_hans_cn": "日期不补零，例如 8 Dec 2026。"},
    {"en": "Settings", "zh_hant_hk": "設定", "zh_hans_cn": "设置"},
    {"en": "Strategies", "zh_hant_hk": "策略", "zh_hans_cn": "策略"},
    {"en": "Style tokens", "zh_hant_hk": "樣式權杖", "zh_hans_cn": "样式令牌"},
    {"en": "Switch theme", "zh_hant_hk": "切換主題", "zh_hans_cn": "切换主题"},
    {"en": "Switch to Dark mode", "zh_hant_hk": "切換至深色模式", "zh_hans_cn": "切换至深色模式"},
    {"en": "Switch to Light mode", "zh_hant_hk": "切換至淺色模式", "zh_hans_cn": "切换至浅色模式"},
    {"en": "System", "zh_hant_hk": "系統", "zh_hans_cn": "系统"},
    {"en": "Timestamp", "zh_hant_hk": "時間戳記", "zh_hans_cn": "时间戳"},
    {"en": "繁體中文（香港）", "zh_hant_hk": "繁體中文（香港）", "zh_hans_cn": "繁體中文（香港）"},
    {"en": "简体中文(中国大陆)", "zh_hant_hk": "简体中文(中国大陆)", "zh_hans_cn": "简体中文(中国大陆)"},
    {"en": "Translations saved.", "zh_hant_hk": "翻譯已儲存。", "zh_hans_cn": "翻译已保存。"},
    {"en": "Tune the Light and Dark values independently. Changes stay in this browser.", "zh_hant_hk": "獨立調整淺色與深色數值。變更只會保留在此瀏覽器。", "zh_hans_cn": "独立调节浅色与深色数值。修改仅保存在此浏览器中。"},
    {"en": "Unable to save translations right now.", "zh_hant_hk": "目前無法儲存翻譯。", "zh_hans_cn": "暂时无法保存翻译。"},
    {"en": "Upload i18n mapping", "zh_hant_hk": "上傳 i18n 對照表", "zh_hans_cn": "上传 i18n 映射表"},
    {"en": "Year-first numeric format, such as 2026/12/08.", "zh_hant_hk": "年份在前的數字格式，例如 2026/12/08。", "zh_hans_cn": "年份在前的数字格式，例如 2026/12/08。"},
    {"en": "European day-first numeric format, such as 08/12/2026.", "zh_hant_hk": "歐洲日月年數字格式，例如 08/12/2026。", "zh_hans_cn": "欧洲日月年数字格式，例如 08/12/2026。"},
    {"en": "Use the text field for any CSS color expression. Hex colors also expose a native color picker. The positive green group intentionally keeps separate Light and Dark values.", "zh_hant_hk": "可使用文字欄位輸入任何 CSS 色彩表達式。Hex 色彩亦會顯示原生色彩選擇器。正面綠色分組特意保留獨立的淺色與深色數值。", "zh_hans_cn": "可使用文本字段输入任意 CSS 颜色表达式。Hex 颜色还会显示原生取色器。正向绿色分组特意保留独立的浅色与深色数值。"},
)


def _build_translation_rows(
    rows: tuple[tuple[str, str, str], ...],
) -> tuple[dict[str, str], ...]:
    return tuple(
        {
            "en": english,
            "zh_hant_hk": traditional,
            "zh_hans_cn": simplified,
        }
        for english, traditional, simplified in rows
    )


SETTINGS_TRANSLATION_ROWS = _build_translation_rows(
    (
        ("Compare up to five tickers across the same daily window with local caching and optional cash dividend inclusion.", "在相同的每日區間內比較最多五個股票代號，支援本機快取及選擇是否計入現金股息。", "在相同的每日区间内比较最多五个股票代码，支持本地缓存及选择是否计入现金股息。"),
        ("Comparison window", "比較區間", "比较区间"),
        ("Relative", "相對", "相对"),
        ("Exact", "精確", "精确"),
        ("Period", "期間", "期间"),
        ("Exact range", "精確範圍", "精确范围"),
        ("Start from", "開始於", "开始于"),
        ("to", "至", "至"),
        ("Reinvest cash dividends", "將現金股息再投資", "将现金股息再投资"),
        ("Price return only", "僅計價格回報", "仅计算价格收益"),
        ("Performance summary", "表現摘要", "表现摘要"),
        ("Stock return comparison", "股票回報比較", "股票收益比较"),
        ("Comparison", "比較", "比较"),
        ("Price", "價格", "价格"),
        ("Market cap", "市值", "市值"),
        ("Market cap comparison", "市值比較", "市值比较"),
        ("Market cap history", "市值歷史", "市值历史"),
        ("Price performance", "價格表現", "价格表现"),
        ("Price history", "價格歷史", "价格历史"),
        ("Ticker comparison", "股票代號比較", "股票代码比较"),
        ("Price comparisons support up to 5 tickers. Remove an extra ticker before switching.", "價格比較最多支援 5 個股票代號。切換前請移除多餘的股票代號。", "价格比较最多支持 5 个股票代码。切换前请移除多余的股票代码。"),
        ("Resolve the highlighted ticker before switching metrics.", "切換指標前請先修正醒目的股票代號。", "切换指标前请先修正突出显示的股票代码。"),
        ("Complete the required comparison fields before switching metrics.", "切換指標前請先完成必要的比較欄位。", "切换指标前请先完成必要的比较字段。"),
        ("Calculating market-cap history", "正在計算市值歷史", "正在计算市值历史"),
        ("Combining historical prices with point-in-time shares for the selected range. Longer ranges may take a moment.", "正在合併所選區間的歷史價格與時點在外流通股數。較長區間可能需要一些時間。", "正在合并所选区间的历史价格与时点流通股数。较长区间可能需要一些时间。"),
        ("Updating price history", "正在更新價格歷史", "正在更新价格历史"),
        ("Loading the selected New York market-time range while keeping the current chart context visible.", "正在載入所選紐約市場時段，同時保留目前圖表內容。", "正在加载所选纽约市场时段，同时保留当前图表内容。"),
        ("Workspace", "工作區", "工作区"),
        ("Portfolio summary", "投資組合摘要", "投资组合摘要"),
        ("Portfolio return chart", "投資組合回報圖表", "投资组合收益图表"),
        ("Add ticker weights to compute the portfolio return.", "加入股票代號權重以計算投資組合回報。", "添加股票代码权重以计算投资组合收益。"),
        ("Grid trading", "網格交易", "网格交易"),
        ("A full-screen workspace for strategy trading notifications and operator review.", "用於策略交易通知及操作員檢閱的全螢幕工作區。", "用于策略交易通知及操作员审阅的全屏工作区。"),
        ("Backtest controls", "回測控制項", "回测控件"),
        ("Configure a ticker, strategy, and isolated capital amount, then run a single-ticker backtest.", "設定股票代號、策略及獨立資金額，然後執行單一股票代號回測。", "设置股票代码、策略及独立资金金额，然后执行单一股票代码回测。"),
        ("Backtest result", "回測結果", "回测结果"),
        ("Run a backtest to inspect performance metrics and chart output.", "執行回測以檢視表現指標及圖表輸出。", "执行回测以查看表现指标及图表输出。"),
        ("Ticker", "股票代號", "股票代码"),
        ("Strategy", "策略", "策略"),
        ("Initial capital (USD)", "初始資金（USD）", "初始资金（USD）"),
        ("Allow algorithmic stop-loss exits", "允許演算法止損", "允许算法止损"),
        ("Allow strategy sell or cover signals to close a position when the exit price represents a loss relative to the entry price. This price-only check excludes dividends and total return. This setting does not add a separate fixed-price stop.", "允許策略的賣出或回補訊號在出場價格相對入場價格構成價格虧損時平倉。此判斷僅比較價格，不包含股息或總回報。此設定不會新增獨立的固定價格止損。", "允许策略的卖出或回补信号在退出价格相对入场价格构成价格亏损时平仓。此判断仅比较价格，不包含股息或总回报。此设置不会添加单独的固定价格止损。"),
        ("Show trade details", "顯示交易詳情", "显示交易详情"),
        ("Performance", "表現", "表现"),
        ("Trade actions and net asset curve", "交易操作及淨資產曲線", "交易操作及净资产曲线"),
        ("Metrics", "指標", "指标"),
        ("Transaction details", "交易詳情", "交易详情"),
        ("No backtest has been run yet.", "尚未執行回測。", "尚未执行回测。"),
        ("Interval", "間隔", "间隔"),
        ("Amount per period (USD)", "每期金額（USD）", "每期金额（USD）"),
        ("Frequency", "頻率", "频率"),
        ("Weekly", "每週", "每周"),
        ("Monthly", "每月", "每月"),
        ("Buy on", "買入日", "买入日"),
        ("Buy on (calendar day)", "買入日（曆日）", "买入日（自然日）"),
        ("Recurring buys and total return curve", "定期買入及總回報曲線", "定期买入及总收益曲线"),
        ("No recurring investment simulation has been run yet.", "尚未執行定期投資模擬。", "尚未执行定期投资模拟。"),
        ("Configure a ticker, contribution amount, and cadence to simulate recurring buys.", "設定股票代號、供款金額及週期以模擬定期買入。", "设置股票代码、投入金额及周期以模拟定期买入。"),
        ("Portfolio ending return", "投資組合期末回報", "投资组合期末收益"),
        ("Allocation", "配置", "配置"),
        ("Weight", "權重", "权重"),
        ("Timing", "時機", "时机"),
        ("Settings content will live in this workspace next.", "設定內容將在此工作區中提供。", "设置内容将在此工作区中提供。"),
        ("yfinance reachable", "yfinance 可連線", "yfinance 可连接"),
        ("yfinance unavailable", "yfinance 不可用", "yfinance 不可用"),
        ("Logo retrieval", "標誌擷取", "标志获取"),
        ("Logo services reachable", "標誌服務可連線", "标志服务可连接"),
        ("Logo services unavailable", "標誌服務不可用", "标志服务不可用"),
        ("Service status", "服務狀態", "服务状态"),
        ("Service", "服務", "服务"),
        ("Status", "狀態", "状态"),
        ("Note", "備註", "备注"),
        ("Available", "可用", "可用"),
        ("Unavailable", "不可用", "不可用"),
        ("Reachable in the current environment.", "在目前環境中可連線。", "在当前环境中可连接。"),
        ("Blocked or unavailable in the current environment.", "在目前環境中被阻擋或不可用。", "在当前环境中被阻止或不可用。"),
        ("Locally cached market datasets available in this workspace, including 1-minute history stored as the latest 6 months of trading days.", "此工作區可用的本機快取市場資料集，包括以最近六個交易月儲存的 1 分鐘歷史資料。", "此工作区可用的本地缓存市场数据集，包括按最近六个交易月存储的 1 分钟历史数据。"),
        ("Maintain all data", "維護所有資料", "维护所有数据"),
        ("Refresh every cached daily dataset and protected brand asset in one pass. 1-minute data is refreshed per ticker and stored as the latest 6 months of trading days.", "一次過重新整理所有快取的每日資料集及受保護品牌資產。1 分鐘資料會按股票代號重新整理，並儲存最近六個交易月。", "一次性刷新所有缓存的每日数据集及受保护品牌资产。1 分钟数据会按股票代码刷新，并存储最近六个交易月。"),
        ("Refreshing all cached daily datasets and protected brand assets. Keep this page open while maintenance is in progress.", "正在重新整理所有快取的每日資料集及受保護品牌資產。維護進行期間請保持此頁面開啟。", "正在刷新所有缓存的每日数据集及受保护品牌资产。维护进行期间请保持此页面打开。"),
        ("Maintaining", "維護中", "维护中"),
        ("Live maintenance is active", "即時維護進行中", "实时维护进行中"),
        ("Configure Yahoo Mail SMTP for strategy-trade notifications. Use smtp.mail.yahoo.com:587 with STARTTLS and a Yahoo Mail app password.", "為策略交易通知設定 Yahoo Mail SMTP。請使用 smtp.mail.yahoo.com:587、STARTTLS 及 Yahoo Mail 應用程式密碼。", "为策略交易通知设置 Yahoo Mail SMTP。请使用 smtp.mail.yahoo.com:587、STARTTLS 及 Yahoo Mail 应用密码。"),
        ("SMTP host", "SMTP 主機", "SMTP 主机"),
        ("Port", "連接埠", "端口"),
        ("Yahoo app password", "Yahoo 應用程式密碼", "Yahoo 应用密码"),
        ("Yahoo email", "Yahoo 電郵", "Yahoo 电子邮件"),
        ("Use STARTTLS", "使用 STARTTLS", "使用 STARTTLS"),
        ("A password is already stored locally. Leave this field empty to keep it unchanged.", "本機已儲存密碼。如要保留現有密碼，請將此欄留空。", "本地已存储密码。如要保留现有密码，请将此字段留空。"),
        ("Save SMTP config", "儲存 SMTP 設定", "保存 SMTP 配置"),
        ("Test Yahoo SMTP", "測試 Yahoo SMTP", "测试 Yahoo SMTP"),
        ("SMTP connection test succeeded.", "SMTP 連線測試成功。", "SMTP 连接测试成功。"),
        ("SMTP connection test failed.", "SMTP 連線測試失敗。", "SMTP 连接测试失败。"),
        ("Logo", "標誌", "标志"),
        ("Symbol", "代號", "代码"),
        ("Full name", "全名", "全名"),
        ("Available range", "可用範圍", "可用范围"),
        ("1m", "1m", "1m"),
        ("Update", "更新", "更新"),
        ("Delete", "刪除", "删除"),
        ("No local market data is available yet.", "尚未有可用的本機市場資料。", "尚无可用的本地市场数据。"),
        ("ending return", "期末回報", "期末收益"),
        ("Range", "範圍", "范围"),
        ("Return mode", "回報模式", "收益模式"),
        ("Cash dividends included", "包括現金股息", "包括现金股息"),
        ("Cash dividends reinvested", "現金股息已再投資", "现金股息已再投资"),
        ("Code version:", "程式碼版本：", "代码版本："),
        ("Updated on:", "更新日期：", "更新日期："),
        ("Winner", "優勝者", "优胜者"),
        ("Settings sections", "設定分區", "设置分区"),
        ("What this service does", "此服務的功能", "此服务的功能"),
        ("Worthward is a local-first workspace for comparing supported-market stocks and historical market caps, building weighted portfolios, simulating dollar-cost averaging, running strategy and grid-trading backtests, and reviewing locally imported investment records. It uses locally cached daily and recent 1-minute market data; optional Longbridge connectivity powers protected live-trading workflows, while IBKR remains file-import-only.", "Worthward 是一個本地優先的工作區，用於比較受支援市場的股票及歷史市值、建立加權投資組合、模擬定期投資、執行策略及網格交易回測，並檢視本機匯入的投資記錄。應用程式使用本機快取的每日及近期 1 分鐘市場資料；設定 Longbridge 後可支援受保護的實盤交易工作流程，而 IBKR 仍僅支援檔案匯入。", "Worthward 是一个本地优先的工作区，用于比较受支持市场的股票及历史市值、构建加权投资组合、模拟定投、运行策略及网格交易回测，并查看本地导入的投资记录。应用使用本地缓存的每日及近期 1 分钟市场数据；配置 Longbridge 后可支持受保护的实盘交易工作流，而 IBKR 仍仅支持文件导入。"),
        ("System information", "系統資訊", "系统信息"),
        ("Source code", "原始碼", "源代码"),
        ("Disclaimer", "免責聲明", "免责声明"),
        ("This service does not provide financial advice. All information — including share prices, returns, and backtest results — is for educational purposes only and does not constitute a recommendation to buy, sell, or hold any security.", "此服務不提供財務建議。所有資訊，包括股價、回報及回測結果，僅供教育用途，並不構成買入、出售或持有任何證券的建議。", "此服务不提供财务建议。所有信息，包括股价、收益及回测结果，仅供教育用途，不构成买入、卖出或持有任何证券的建议。"),
        ("The value of investments can go down as well as up. Past performance is not a reliable indicator of future results. Seek independent professional advice before making investment decisions.", "投資價值可升亦可跌。過往表現並非未來結果的可靠指標。作出投資決定前，請尋求獨立專業意見。", "投资价值可升亦可跌。过往表现并非未来结果的可靠指标。作出投资决定前，请寻求独立专业意见。"),
        ("Market data is sourced from third parties on an \"as is\" basis with no guarantee of accuracy or completeness.", "市場資料按「現狀」由第三方提供，並不保證準確或完整。", "市场数据按「现状」由第三方提供，不保证准确或完整。"),
        ("Backtest execution model", "回測執行模式", "回测执行模式"),
        ("Choose how a signal bar is translated into an executed trade.", "選擇如何將訊號柱轉換為已執行的交易。", "选择如何将信号柱转换为已执行的交易。"),
        ("Signal bar close", "訊號柱收市", "信号柱收盘"),
        ("When a signal appears, execute the trade at the closing price of the same bar. This is simple and deterministic, but it is more optimistic because the model uses the bar that generated the signal.", "訊號出現時，以同一訊號柱的收市價執行交易。此方式簡單且具確定性，但較為樂觀，因為模型使用了產生訊號的柱。", "信号出现时，以同一信号柱的收盘价执行交易。此方式简单且具确定性，但较为乐观，因为模型使用了产生信号的柱。"),
        ("Next bar open", "下一柱開市", "下一柱开盘"),
        ("When a signal appears, queue the trade for the next bar's opening price. This is more conservative and avoids using the signal bar's closing price.", "訊號出現時，將交易排程至下一柱的開市價執行。此方式較為保守，並避免使用訊號柱的收市價。", "信号出现时，将交易排程至下一柱的开盘价执行。此方式较为保守，并避免使用信号柱的收盘价。"),
        ("Investment", "投資", "投资"),
        ("Investment accounting", "投資會計", "投资会计"),
        ("Choose how each sell is matched to the open buy inventory. Holdings, Stock details, and local realized P&L use the same method.", "選擇每次賣出如何與未平倉買入批次配對。持倉、股票詳情及本地已實現損益使用相同方法。", "请选择每次卖出如何与未平仓买入批次匹配。持仓、股票详情及本地已实现损益使用相同方法。"),
        ("Sell matching method", "賣出配對方法", "卖出匹配方法"),
        ("Match sells against the lowest-cost open lots first. This is the default strategy-attribution method.", "將賣出優先與成本最低的未平倉批次配對。這是預設的策略歸因方法。", "将卖出优先与成本最低的未平仓批次匹配。这是默认的策略归因方法。"),
        ("Lowest-cost lots first", "成本最低批次優先", "成本最低批次优先"),
        ("Match sells against the oldest open lots first.", "將賣出優先與最早的未平倉批次配對。", "将卖出优先与最早的未平仓批次匹配。"),
        ("First in, first out (FIFO)", "先進先出（FIFO）", "先进先出（FIFO）"),
        ("Match sells against the newest open lots first.", "將賣出優先與最新的未平倉批次配對。", "将卖出优先与最新的未平仓批次匹配。"),
        ("Last in, first out (LIFO)", "後進先出（LIFO）", "后进先出（LIFO）"),
        ("Pool open buys into one moving average cost before each sell.", "每次賣出前，將未平倉買入合併為一個移動平均成本。", "每次卖出前，将未平仓买入合并为一个移动平均成本。"),
        ("Moving average cost", "移動平均成本", "移动平均成本"),
        ("Broker-reported closed-trade P&L remains authoritative when available. Transfer-basis reconstruction remains separately labelled as FIFO reconstructed.", "如有券商報告的已平倉交易損益，仍以其為準。轉倉成本基礎重建則會獨立標示為 FIFO 重建。", "如有券商报告的已平仓交易损益，仍以其为准。转仓成本基础重建则会单独标示为 FIFO 重建。"),
        ("Token map", "權杖對照表", "令牌映射表"),
        ("Run the network checks again and refresh the availability results shown below.", "再次執行網絡檢查，並更新下方顯示的可用性結果。", "再次执行网络检查，并更新下方显示的可用性结果。"),
        ("Last checked:", "上次檢查：", "上次检查："),
        ("Not checked yet.", "尚未檢查。", "尚未检查。"),
        ("Check again", "再次檢查", "再次检查"),
        ("Review the latest connectivity and dependency availability checks for this device.", "檢視此裝置最新的連線及依賴項可用性檢查結果。", "查看此设备最新的连接及依赖项可用性检查结果。"),
        ("Checking...", "檢查中…", "检查中…"),
        ("Running independent checks from the application host...", "正在從應用程式主機執行獨立檢查…", "正在从应用主机执行独立检查…"),
        ("Review every fixed external dependency used by this application from the application host.", "檢視此應用程式從應用程式主機使用的每項固定外部依賴項。", "查看此应用从应用主机使用的每项固定外部依赖项。"),
        ("Checks run from the application host. HTTP(S) probes honor standard proxy variables and verified TLS; account credentials are not submitted here.", "檢查從應用程式主機執行。HTTP(S) 探測遵循標準代理變數及已驗證 TLS；此頁面不會提交帳戶憑證。", "检查从应用主机执行。HTTP(S) 探测遵循标准代理变量及已验证 TLS；此页面不会提交账户凭据。"),
        ("Each row is checked independently, so a blocked provider does not prevent the remaining diagnostics from completing.", "每個項目均獨立檢查，因此某個被封鎖的服務不會阻止其餘診斷完成。", "每一项均独立检查，因此某个被阻断的服务不会阻止其余诊断完成。"),
        ("Checking whether Yahoo Finance can be reached from this device.", "正在檢查此裝置能否連線至 Yahoo Finance。", "正在检查此设备能否连接至 Yahoo Finance。"),
        ("Checking whether the primary ticker logo service and its fallbacks can be reached from this device.", "正在檢查此裝置能否連線至主要股票代號標誌服務及其後備服務。", "正在检查此设备能否连接至主要股票代码标志服务及其备用服务。"),
        ("Checking whether Google (Hong Kong) can be reached from this device.", "正在檢查此裝置能否連線至 Google（香港）。", "正在检查此设备能否连接至 Google（香港）。"),
        ("Yahoo Finance is reachable, so missing price history can be refreshed from the network.", "Yahoo Finance 可連線，因此可從網絡重新整理缺失的價格歷史資料。", "Yahoo Finance 可连接，因此可从网络刷新缺失的价格历史数据。"),
        ("Yahoo Finance could not be reached. Check the proxy and corporate CA configuration; local market data remains available.", "無法連線至 Yahoo Finance。請檢查代理伺服器及企業 CA 設定；本機市場資料仍可使用。", "无法连接至 Yahoo Finance。请检查代理服务器及企业 CA 配置；本地市场数据仍可用。"),
        ("Logo providers are reachable, so missing brand marks can be fetched when needed.", "標誌供應商可連線，因此需要時可擷取缺失的品牌標誌。", "标志供应商可连接，因此需要时可获取缺失的品牌标志。"),
        ("Remote logo sources could not be reached. Check the proxy and corporate CA configuration; stored logos remain available.", "無法連線至遠端標誌來源。請檢查代理伺服器及企業 CA 設定；已儲存的標誌仍可使用。", "无法连接至远程标志来源。请检查代理服务器及企业 CA 配置；已存储的标志仍可用。"),
        ("Google (Hong Kong) is reachable from this device.", "此裝置可連線至 Google（香港）。", "此设备可连接至 Google（香港）。"),
        ("Google (Hong Kong) could not be reached from this device.", "此裝置無法連線至 Google（香港）。", "此设备无法连接至 Google（香港）。"),
        ("Value name", "數值名稱", "数值名称"),
        ("Default", "預設值", "默认值"),
        ("Meaning", "含義", "含义"),
        ("Close", "關閉", "关闭"),
        ("Yahoo Mail personal accounts require an app password for SMTP. Keep STARTTLS enabled and use your full <code>@yahoo.com</code> address with the generated app password.", "Yahoo Mail 個人帳戶使用 SMTP 時需要應用程式密碼。請保持 STARTTLS 啟用，並使用完整的 <code>@yahoo.com</code> 地址及已產生的應用程式密碼。", "Yahoo Mail 个人账户使用 SMTP 时需要应用密码。请保持 STARTTLS 启用，并使用完整的 <code>@yahoo.com</code> 地址及已生成的应用密码。"),
        ("Store the Yahoo SMTP endpoint, mailbox, app password, and STARTTLS setting on this device.", "在此裝置儲存 Yahoo SMTP 端點、郵箱、應用程式密碼及 STARTTLS 設定。", "在此设备存储 Yahoo SMTP 端点、邮箱、应用密码及 STARTTLS 设置。"),
        ("Verify SMTP login against Yahoo Mail with the saved app password.", "使用已儲存的應用程式密碼驗證 Yahoo Mail 的 SMTP 登入。", "使用已存储的应用密码验证 Yahoo Mail 的 SMTP 登录。"),
        ("This project is fully open source. Your credentials are stored only on your local machine and are never shared with the developer or any third party beyond the chosen broker.", "此專案完全開放原始碼。你的憑證只會儲存在本機，不會與開發者或所選券商以外的任何第三方分享。", "此项目完全开源。你的凭据只会存储在本地，不会与开发者或所选券商以外的任何第三方分享。"),
        ("Broker", "券商", "券商"),
        ("Longbridge OAuth", "Longbridge OAuth", "Longbridge OAuth"),
        ("Authorize through the installed Longbridge CLI in a separate browser window. Worthward does not receive, display, or store the authorization code or OAuth token. Your existing terminal CLI profile is used automatically.", "在獨立瀏覽器視窗中透過已安裝的 Longbridge CLI 授權。Worthward 不會接收、顯示或儲存授權碼或 OAuth token，並會自動使用現有的終端機 CLI 設定檔。", "在独立浏览器窗口中通过已安装的 Longbridge CLI 授权。Worthward 不会接收、显示或存储授权码或 OAuth token，并会自动使用现有的终端 CLI 配置文件。"),
        ("Authorize in browser", "在瀏覽器中授權", "在浏览器中授权"),
        ("Direct IBKR connectivity is not configured. For trading history, import official IBKR CSV or GainsKeeper files in Trade → Investment. For personal prices and market data, use Longbridge.", "未設定 IBKR 直接連線。如需交易歷史，請在交易 → 投資中匯入官方 IBKR CSV 或 GainsKeeper 檔案。如需個人價格及市場資料，請使用 Longbridge。", "未设置 IBKR 直接连接。如需交易历史，请在交易 → 投资中导入官方 IBKR CSV 或 GainsKeeper 文件。如需个人价格及市场数据，请使用 Longbridge。"),
        ("Healthy connection", "連線正常", "连接正常"),
        ("Broker connection test", "券商連線測試", "券商连接测试"),
        ("The broker is connected and ready. You can still test detailed connection parameters, including latency. This does not place any order.", "券商已連線並準備就緒。你仍可測試包括延遲在內的詳細連線參數。此操作不會下單。", "券商已连接并准备就绪。你仍可测试包括延迟在内的详细连接参数。此操作不会下单。"),
        ("Try the current broker authentication against the selected service and report whether it works. This only verifies connectivity and does not place any order.", "使用目前券商驗證資料連線至所選服務，並回報是否成功。此操作只會驗證連線，不會下單。", "使用当前券商验证信息连接至所选服务，并报告是否成功。此操作只会验证连接，不会下单。"),
        ("Test connection", "測試連線", "测试连接"),
        ("Tested at", "測試時間", "测试时间"),
        ("This removes non-local market search caches, search profiles, and search logos. Anything already protected by Local Market Store keeps its parquet history, company profiles, logo images, matching ticker search caches, and ticker usage records.", "此操作會移除非本機市場搜尋快取、搜尋設定檔及搜尋標誌。已受本機市場資料庫保護的內容會保留其 parquet 歷史資料、公司資料、標誌圖片、相符股票代號搜尋快取及股票代號使用記錄。", "此操作会移除非本地市场搜索缓存、搜索配置文件及搜索标志。已受本地市场数据库保护的内容会保留其 parquet 历史数据、公司资料、标志图片、匹配股票代码搜索缓存及股票代码使用记录。"),
        ("Clear market data caches", "清除市場資料快取", "清除市场数据缓存"),
        ("This deletes <code>settings_store/investment.parquet</code> on this device, which removes the imported local broker transaction history shown in My investment.", "此操作會刪除此裝置上的 <code>settings_store/investment.parquet</code>，並移除「我的投資」中顯示的本機券商交易歷史。", "此操作会删除此设备上的 <code>settings_store/investment.parquet</code>，并移除「我的投资」中显示的本地券商交易历史。"),
        ("Clear local broker transaction record", "清除本機券商交易記錄", "清除本地券商交易记录"),
        ("Resize style token demos", "調整樣式權杖示範區大小", "调整样式令牌示范区大小"),
        ("Style token range mode", "樣式權杖範圍模式", "样式令牌范围模式"),
        ("Live marker", "即時標記", "实时标记"),
        ("Clear input", "清除輸入內容", "清除输入内容"),
        ("Clear ticker", "清除股票代號", "清除股票代码"),
        ("Remove ticker", "移除股票代號", "移除股票代码"),
        ("Reusable style", "可重用樣式", "可复用样式"),
        ("Pagination demo", "分頁示範", "分页示范"),
        ("Add a ticker", "加入股票代號", "添加股票代码"),
        ("Remove", "移除", "移除"),
        ("Stocks", "股票類", "股票类"),
        ("Configurable exchange-traded securities", "可設定的交易所交易證券", "可配置的交易所交易证券"),
        ("No stock cash equivalents configured.", "未設定股票類現金等價物。", "未配置股票类现金等价物。"),
        ("Funds", "基金類", "基金类"),
        ("Configured money-market funds", "已設定的貨幣市場基金", "已配置的货币市场基金"),
        ("No money-market funds configured.", "未設定貨幣市場基金。", "未配置货币市场基金。"),
        ("Resize export image previews", "調整匯出圖片預覽大小", "调整导出图片预览大小"),
        ("Investment share preview", "投資分享預覽", "投资分享预览"),
        ("Workspace share preview", "工作區分享預覽", "工作区分享预览"),
        ("Show previous investment share preview", "顯示上一個投資分享預覽", "显示上一个投资分享预览"),
        ("Show next investment share preview", "顯示下一個投資分享預覽", "显示下一个投资分享预览"),
        ("Show previous workspace share preview", "顯示上一個工作區分享預覽", "显示上一个工作区分享预览"),
        ("Show next workspace share preview", "顯示下一個工作區分享預覽", "显示下一个工作区分享预览"),
        ("Mask Sensitive Values", "遮蔽敏感值", "遮蔽敏感值"),
        ("Show Sensitive Values", "顯示敏感值", "显示敏感值"),
        ("Welcome to vibe and star this project.", "歡迎使用，並為此專案點選 star。", "欢迎使用，并为此项目点选 star。"),
        ("Overview", "概覽", "概览"),
        ("Details", "詳情", "详情"),
        ("Holdings", "持倉", "持仓"),
        ("Stock details", "股票詳情", "股票详情"),
        ("Portfolio", "投資組合", "投资组合"),
        ("DCA", "定投", "定投"),
        ("Return comparison", "回報比較", "收益比较"),
        ("Total return", "總回報", "总收益"),
        ("CAGR", "複合年增長率", "复合年增长率"),
        ("Max drawdown", "最大回撤", "最大回撤"),
        ("Sharpe", "Sharpe", "Sharpe"),
        ("Last", "最新", "最新"),
        ("Day", "日內", "日内"),
        ("Shares", "股數", "股数"),
        ("Market value", "市值", "市值"),
        ("Total equity", "總資產值", "总资产值"),
        ("Cumulative P&L", "累計損益", "累计损益"),
        ("Realized P&L", "已實現損益", "已实现损益"),
        ("Unrealized P&L", "未實現損益", "未实现损益"),
        ("Commission", "佣金", "佣金"),
        ("Interest", "利息", "利息"),
        ("Copy style name", "複製樣式名稱", "复制样式名称"),
        ("Copied", "已複製", "已复制"),
        ("Summary", "摘要", "摘要"),
        ("The broker is connected and ready.", "券商已連線並準備就緒。", "券商已连接并准备就绪。"),
        ("Baseline", "基準", "基准"),
        ("Recent", "最近使用", "最近使用"),
        ("All", "全部", "全部"),
        ("Buy", "買入", "买入"),
        ("Sell", "賣出", "卖出"),
        ("Increase value", "增加數值", "增加数值"),
        ("Decrease value", "減少數值", "减少数值"),
        ("Local market store pages", "本機市場資料庫頁面", "本地市场数据库页面"),
        ("Previous pages", "上一頁", "上一页"),
        ("Next pages", "下一頁", "下一页"),
        ("Toggle sidebar", "切換側邊欄", "切换侧边栏"),
        ("Global quick actions", "全域快速操作", "全局快速操作"),
        ("Close sidebar", "關閉側邊欄", "关闭侧边栏"),
        ("Workspace modes", "工作區模式", "工作区模式"),
        ("Error", "錯誤", "错误"),
        ("Close error notice", "關閉錯誤通知", "关闭错误通知"),
        ("Notice", "通知", "通知"),
        ("Updating local market data", "正在更新本機市場資料", "正在更新本地市场数据"),
        ("This may take a moment while the app checks remote data and refreshes the local store.", "應用程式檢查遠端資料並重新整理本機資料庫時可能需要一些時間。", "应用程序检查远程数据并刷新本地数据库时可能需要一些时间。"),
        ("Buy and hold", "買入並持有", "买入并持有"),
        ("SuperTrend AI", "SuperTrend AI", "SuperTrend AI"),
        ("SuperTrend AI (Gemini)", "SuperTrend AI（Gemini）", "SuperTrend AI（Gemini）"),
        ("Lorentzian Classification", "Lorentzian 分類", "Lorentzian 分类"),
        ("Lorentzian Classification (ChatGPT)", "Lorentzian 分類（ChatGPT）", "Lorentzian 分类（ChatGPT）"),
        ("Lorentzian Classification (Gemini)", "Lorentzian 分類（Gemini）", "Lorentzian 分类（Gemini）"),
        ("MACD", "MACD", "MACD"),
        ("MACD (Gemini)", "MACD（Gemini）", "MACD（Gemini）"),
        ("kNN Machine Learning", "kNN 機器學習", "kNN 机器学习"),
        ("kNN Machine Learning (Gemini)", "kNN 機器學習（Gemini）", "kNN 机器学习（Gemini）"),
        ("Grid Trading", "網格交易", "网格交易"),
        ("Baseline strategy that buys at the first available bar and exits at the last available bar.", "在第一個可用訊號柱買入，並在最後一個可用訊號柱退出的基準策略。", "在第一个可用信号柱买入，并在最后一个可用信号柱退出的基准策略。"),
        ("MACD crossover strategy using default daily 12, 26, and 9 settings.", "使用每日 12、26 及 9 預設設定的 MACD 交叉策略。", "使用每日 12、26 及 9 默认设置的 MACD 交叉策略。"),
        ("Trades price moves from the last execution with configurable trigger bounds and asymmetric rise/fall percentages.", "根據上次執行價的價格變動，使用可設定的觸發範圍及非對稱升跌百分比進行交易。", "根据上次执行价的价格变动，使用可配置的触发范围及非对称涨跌百分比进行交易。"),
        ("Optimized adaptive multi-factor SuperTrend strategy using NumPy array broadcasting for fast factor clustering.", "使用 NumPy 陣列廣播以快速進行因子叢集的最佳化自適應多因子 SuperTrend 策略。", "使用 NumPy 数组广播以快速进行因子聚类的优化自适应多因子 SuperTrend 策略。"),
        ("kNN regime classifier adhering strictly to the Worthward LLM Strategy Developer Prompt guidelines.", "嚴格遵循 Worthward LLM Strategy Developer Prompt 指引的 kNN 狀態分類器。", "严格遵循 Worthward LLM Strategy Developer Prompt 指引的 kNN 状态分类器。"),
        ("Adaptive multi-factor SuperTrend strategy with three-cluster factor selection inspired by the LuxAlgo PineScript.", "受 LuxAlgo PineScript 啟發、使用三叢集因子選擇的自適應多因子 SuperTrend 策略。", "受 LuxAlgo PineScript 启发、使用三簇因子选择的自适应多因子 SuperTrend 策略。"),
        ("ATR Length", "ATR 長度", "ATR 长度"),
        ("Minimum Factor", "最小因子", "最小因子"),
        ("Maximum Factor", "最大因子", "最大因子"),
        ("Factor Step", "因子步長", "因子步长"),
        ("Performance Memory", "表現記憶", "表现记忆"),
        ("From Cluster", "來源叢集", "来源簇"),
        ("Maximum Iteration Steps", "最大迭代步數", "最大迭代步数"),
        ("Historical Bars Calculation", "歷史柱計算量", "历史柱计算量"),
        ("Source", "來源", "来源"),
        ("Neighbors Count", "鄰居數量", "邻居数量"),
        ("Max Bars Back", "最大回看柱數", "最大回看柱数"),
        ("Feature Count", "特徵數量", "特征数量"),
        ("Use Dynamic Exits", "使用動態退出", "使用动态退出"),
        ("Use Volatility Filter", "使用波動率篩選器", "使用波动率筛选器"),
        ("Use Regime Filter", "使用狀態篩選器", "使用状态筛选器"),
        ("Use ADX Filter", "使用 ADX 篩選器", "使用 ADX 筛选器"),
        ("Regime Threshold", "狀態閾值", "状态阈值"),
        ("ADX Threshold", "ADX 閾值", "ADX 阈值"),
        ("Feature 1", "特徵 1", "特征 1"),
        ("Feature 1 Param A", "特徵 1 參數 A", "特征 1 参数 A"),
        ("Feature 1 Param B", "特徵 1 參數 B", "特征 1 参数 B"),
        ("Feature 2", "特徵 2", "特征 2"),
        ("Feature 2 Param A", "特徵 2 參數 A", "特征 2 参数 A"),
        ("Feature 2 Param B", "特徵 2 參數 B", "特征 2 参数 B"),
        ("Feature 3", "特徵 3", "特征 3"),
        ("Feature 3 Param A", "特徵 3 參數 A", "特征 3 参数 A"),
        ("Feature 3 Param B", "特徵 3 參數 B", "特征 3 参数 B"),
        ("Feature 4", "特徵 4", "特征 4"),
        ("Feature 4 Param A", "特徵 4 參數 A", "特征 4 参数 A"),
        ("Feature 4 Param B", "特徵 4 參數 B", "特征 4 参数 B"),
        ("Feature 5", "特徵 5", "特征 5"),
        ("Feature 5 Param A", "特徵 5 參數 A", "特征 5 参数 A"),
        ("Feature 5 Param B", "特徵 5 參數 B", "特征 5 参数 B"),
        ("Use EMA Filter", "使用 EMA 篩選器", "使用 EMA 筛选器"),
        ("EMA Period", "EMA 週期", "EMA 周期"),
        ("Use SMA Filter", "使用 SMA 篩選器", "使用 SMA 筛选器"),
        ("SMA Period", "SMA 週期", "SMA 周期"),
        ("Trade with Kernel", "使用 Kernel 交易", "使用 Kernel 交易"),
        ("Enhance Kernel Smoothing", "增強 Kernel 平滑", "增强 Kernel 平滑"),
        ("Kernel Lookback Window", "Kernel 回看視窗", "Kernel 回看窗口"),
        ("Kernel Relative Weighting", "Kernel 相對加權", "Kernel 相对加权"),
        ("Kernel Regression Level", "Kernel 回歸層級", "Kernel 回归层级"),
        ("Kernel Lag", "Kernel 延遲", "Kernel 延迟"),
        ("Indicator", "指標", "指标"),
        ("Short Period", "短週期", "短周期"),
        ("Long Period", "長週期", "长周期"),
        ("Base Neighbours", "基礎鄰居數量", "基础邻居数量"),
        ("Volatility Filter", "波動率篩選器", "波动率筛选器"),
        ("Bar Threshold", "柱閾值", "柱阈值"),
        ("Fast EMA", "快速 EMA", "快速 EMA"),
        ("Slow EMA", "慢速 EMA", "慢速 EMA"),
        ("Signal EMA", "訊號 EMA", "信号 EMA"),
        ("Trigger price min", "觸發價格下限", "触发价格下限"),
        ("Trigger price max", "觸發價格上限", "触发价格上限"),
        ("Rise %", "升幅 %", "涨幅 %"),
        ("Fall %", "跌幅 %", "跌幅 %"),
        ("Segmented control", "分段控制項", "分段控件"),
        ("Settings action button", "設定操作按鈕", "设置操作按钮"),
        ("Shared select filter", "共用選擇篩選器", "共享选择筛选器"),
        ("The standard trigger, dropdown, selected state, and filter options shared by table headers and forms.", "表格標題及表單共用的標準觸發器、下拉選單、選取狀態及篩選選項。", "表格标题及表单共用的标准触发器、下拉菜单、选中状态及筛选选项。"),
        ("Settings action package", "設定操作套件", "设置操作套件"),
        ("Circular icon button", "圓形圖示按鈕", "圆形图标按钮"),
        ("Use the article shell as the desktop baseline. On narrow screens, the mobile heading surface keeps the glass material but drops the shadow before morphing toward the sidebar.", "以文章外框作為桌面基準。在窄螢幕上，流動版標題表面保留玻璃材質但移除陰影，然後向側邊欄變形。", "以文章外框作为桌面基准。在窄屏幕上，移动版标题表面保留玻璃材质但移除阴影，然后向侧边栏变形。"),
        ("Scrollable table", "可滾動表格", "可滚动表格"),
        ("Scrollable table pages", "可滾動表格頁面", "可滚动表格页面"),
        ("Transaction history", "交易歷史", "交易历史"),
        ("Time", "時間", "时间"),
        ("Type", "類型", "类型"),
        ("Description", "描述", "描述"),
        ("Amount", "金額", "金额"),
        ("Cash", "現金", "现金"),
        ("Frosted glass", "磨砂玻璃", "磨砂玻璃"),
        ("The quick brown fox jumps over the lazy dog.", "敏捷的棕色狐狸跳過了懶惰的狗。", "敏捷的棕色狐狸跳过了懒惰的狗。"),
        ("Testing backdrop-filter and transparency performance over a complex gradient background.", "正在複雜漸變背景上測試 backdrop-filter 及透明度效能。", "正在复杂渐变背景上测试 backdrop-filter 及透明度性能。"),
        ("Exported image previews use the same HTML and CSS as workspace and investment PNG exports. The print spec is a portrait card at 53.98 mm by 86.50 mm with a 3.18 mm corner radius, mapped onto a 20 px per mm export grid for readable PNG output.", "匯出圖片預覽使用與工作區及投資 PNG 匯出相同的 HTML 及 CSS。列印規格為 53.98 mm × 86.50 mm 的直向卡片，圓角半徑為 3.18 mm，並映射至每毫米 20 px 的匯出網格，以產生易讀的 PNG。", "导出图片预览使用与工作区及投资 PNG 导出相同的 HTML 及 CSS。打印规格为 53.98 mm × 86.50 mm 的竖向卡片，圆角半径为 3.18 mm，并映射至每毫米 20 px 的导出网格，以生成易读的 PNG。"),
        ("4 filtered of 12 total", "12 項中已篩選 4 項", "12 项中已筛选 4 项"),
        ("Add ticker", "加入股票代號", "添加股票代码"),
        ("Cancel add", "取消加入", "取消添加"),
        ("Clear", "清除", "清除"),
        ("Compare", "比較", "比较"),
        ("Connected", "已連線", "已连接"),
        ("Connection issue", "連線問題", "连接问题"),
        ("Fetch 1d history", "擷取 1d 歷史資料", "获取 1d 历史数据"),
        ("Fetch 1m history for the latest 6 months of trading days", "擷取最近六個交易月的 1m 歷史資料", "获取最近六个交易月的 1m 历史数据"),
        ("Fresh through the latest completed trading day, but the listing is too new to satisfy the long-history completeness threshold.", "資料已更新至最近完成的交易日，但上市時間太短，未能達到長期歷史資料完整性門檻。", "数据已更新至最近完成的交易日，但上市时间太短，未能达到长期历史数据完整性门槛。"),
        ("Google (Hong Kong)", "Google（香港）", "Google（香港）"),
        ("Loading", "載入中", "加载中"),
        ("Longbridge authorization status checks could not reach this app after 3 attempts. Check your local connection, then authorize again.", "Longbridge 授權狀態檢查連續 3 次無法連線至此應用程式。請檢查本機連線，然後重新授權。", "Longbridge 授权状态检查连续 3 次无法连接至此应用程序。请检查本地连接，然后重新授权。"),
        ("Longbridge authorization status is unavailable.", "Longbridge 授權狀態不可用。", "Longbridge 授权状态不可用。"),
        ("Net", "淨額", "净额"),
        ("New", "新上市", "新上市"),
        ("Review the built-in trading strategies and their reusable backtest parameters in this workspace.", "檢視此工作區內建的交易策略及其可重用回測參數。", "查看此工作区内置的交易策略及其可复用回测参数。"),
        ("This deletes", "此操作會刪除", "此操作会删除"),
        ("When a signal appears, queue the trade and execute it at the opening price of the next bar. This is more conservative and better matches a real decision made after the signal bar has closed.", "訊號出現時，將交易排程至下一柱的開市價執行。此方式較為保守，更貼近訊號柱收市後作出實際決策的情況。", "信号出现时，将交易排程至下一柱的开盘价执行。此方式较为保守，更贴近信号柱收盘后作出实际决策的情况。"),
        ("community share template", "社群分享範本", "社区分享模板"),
        ("on this device, which removes the imported local broker transaction history shown in My investment.", "在此裝置上，並移除「我的投資」中顯示的已匯入本機券商交易歷史。", "在此设备上，并移除「我的投资」中显示的已导入本地券商交易历史。"),
        ("logo", "標誌", "标志"),
        ("parameters", "參數", "参数"),
        ("tokens", "權杖", "令牌"),
        ("Yahoo Mail personal accounts require an app password for SMTP. Keep STARTTLS enabled and use your full", "Yahoo Mail 個人帳戶使用 SMTP 時需要應用程式密碼。請保持 STARTTLS 啟用，並使用完整的", "Yahoo Mail 个人账户使用 SMTP 时需要应用密码。请保持 STARTTLS 启用，并使用完整的"),
        ("address with the generated app password.", "地址及已產生的應用程式密碼。", "地址及已生成的应用密码。"),
        ("Close price", "收市價", "收盘价"),
        ("Investment Holdings allocation badge", "投資持倉配置徽章", "投资持仓配置徽章"),
        ("Pagination", "分頁", "分页"),
        ("Modal dialog", "模態對話框", "模态对话框"),
        ("Modal dialog banner message", "模態對話框橫幅訊息", "模态对话框横幅消息"),
        ("Portfolio donut orbit", "投資組合圓環軌道", "投资组合环形图轨道"),
        ("Settings execution option", "設定執行選項", "设置执行选项"),
        ("Text input control", "文字輸入控制項", "文本输入控件"),
        ("Ticker identity row", "股票代號識別列", "股票代码标识行"),
        ("Ticker input control", "股票代號輸入控制項", "股票代码输入控件"),
        ("Trade strategy stepper", "交易策略步進器", "交易策略步进器"),
        ("Workspace article", "工作區文章", "工作区文章"),
        ("Workspace metric value", "工作區指標數值", "工作区指标数值"),
        ("Backtest execution model updated", "回測執行模型已更新", "回测执行模型已更新"),
        ("Saving daily market data to local cache", "正在將每日市場資料儲存至本機快取", "正在将每日市场数据保存至本地缓存"),
        ("We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.", "我們正在檢查此股票代號是否缺少每日歷史資料，並將新資料儲存至此裝置。下載完成前請保持此頁面開啟。", "我们正在检查此股票代码是否缺少每日历史数据，并将新数据保存至此设备。下载完成前请保持此页面打开。"),
        ("Side filter", "側邊篩選器", "侧边筛选器"),
        ("Ticker 1", "股票代號 1", "股票代码 1"),
        ("Yahoo Mail app password", "Yahoo Mail 應用程式密碼", "Yahoo Mail 应用密码"),
        ("Desktop baseline", "桌面基準", "桌面基准"),
        ("Exported image previews use the same token registry, HTML structure, and CSS as workspace and investment PNG exports. The print spec is a portrait card at 53.98 mm by 86.50 mm with a 3.18 mm corner radius, mapped onto a 20 px per mm export grid for readable PNG output.", "匯出圖片預覽使用與工作區及投資 PNG 匯出相同的權杖登錄表、HTML 結構及 CSS。列印規格為 53.98 mm × 86.50 mm 的直向卡片，圓角半徑為 3.18 mm，並映射至每毫米 20 px 的匯出網格，以產生易讀的 PNG。", "导出图片预览使用与工作区及投资 PNG 导出相同的令牌注册表、HTML 结构及 CSS。打印规格为 53.98 mm × 86.50 mm 的竖向卡片，圆角半径为 3.18 mm，并映射至每毫米 20 px 的导出网格，以生成易读的 PNG。"),
        ("Section title", "分區標題", "分区标题"),
        ("Tooltip", "工具提示", "工具提示"),
        ("Base pixel sizes defined in the design system. These are the source tokens that semantic text roles inherit from.", "設計系統定義的基礎像素大小；語義文字角色會繼承這些來源權杖。", "设计系统定义的基础像素大小；语义文字角色会继承这些源令牌。"),
        ("Intermediate aliases map the primitive scale to UI, title, and metric contexts before component-level tokens consume them.", "中間別名會先將原始尺度映射至介面、標題及指標情境，然後由元件層級權杖使用。", "中间别名会先将原始尺度映射至界面、标题及指标场景，然后由组件级令牌使用。"),
        ("These are the font tokens used directly by the current workspace screens and controls.", "這些是目前工作區畫面及控制項直接使用的字型權杖。", "这些是当前工作区界面及控件直接使用的字体令牌。"),
        ("Primitive scale", "原始尺度", "原始尺度"),
        ("Semantic scale aliases", "語義尺度別名", "语义尺度别名"),
        ("Component text roles", "元件文字角色", "组件文字角色"),
        ("Compact status", "緊湊狀態", "紧凑状态"),
        ("Tooltip copy", "工具提示文字", "工具提示文字"),
        ("Table text", "資料表文字", "数据表文字"),
        ("Form label", "表單標籤", "表单标签"),
        ("Control text", "控制項文字", "控件文字"),
        ("Large metric", "大型指標", "大型指标"),
        ("XL metric", "超大型指標", "超大型指标"),
        ("Weekday labels", "星期標籤", "星期标签"),
        ("Tooltip size", "工具提示大小", "工具提示大小"),
        ("Standard label size", "標準標籤大小", "标准标签大小"),
        ("Standard control size", "標準控制項大小", "标准控件大小"),
        ("Workspace title", "工作區標題", "工作区标题"),
        ("Metric medium", "中型指標", "中型指标"),
        ("Metric large", "大型指標", "大型指标"),
        ("Metric extra large", "超大型指標", "超大型指标"),
        ("Form control", "表單控制項", "表单控件"),
        ("Table body", "資料表內容", "数据表内容"),
        ("Table head", "資料表標題", "数据表标题"),
        ("Card title", "卡片標題", "卡片标题"),
        ("Card subtitle", "卡片副標題", "卡片副标题"),
        ("Metric value", "指標數值", "指标数值"),
        ("Numeric fraction", "數字小數部分", "数字小数部分"),
        ("Ticker  Full name  Available range", "股票代號  全名  可用範圍", "股票代码  全名  可用范围"),
        ("Ticker  Period  Reinvest cash dividends", "股票代號  期間  將現金股息再投資", "股票代码  期间  将现金股息再投资"),
        ("Ticker  Period  Strategy", "股票代號  期間  策略", "股票代码  期间  策略"),
        ("Sun  Mon  Tue  Wed  Thu  Fri  Sat", "週日  週一  週二  週三  週四  週五  週六", "周日  周一  周二  周三  周四  周五  周六"),
        ("Use smtp.mail.yahoo.com:587 with STARTTLS.", "使用 smtp.mail.yahoo.com:587 及 STARTTLS。", "使用 smtp.mail.yahoo.com:587 及 STARTTLS。"),
        ("MACD crossover  |  Exact range  |  2024-01-02 to 2025-03-19", "MACD 交叉  |  精確範圍  |  2024-01-02 至 2025-03-19", "MACD 交叉  |  精确范围  |  2024-01-02 至 2025-03-19"),
        ("2025-03-19  BUY  100 @ 187.42  |  Equity  12,845.90", "2025-03-19  買入  100 @ 187.42  |  資產值  12,845.90", "2025-03-19  买入  100 @ 187.42  |  资产值  12,845.90"),
        ("Investment community share card", "投資社群分享卡片", "投资社区分享卡片"),
        ("Machine Learning", "機器學習", "机器学习"),
        ("Mean Reversion", "均值回歸", "均值回归"),
        ("Momentum", "動量", "动量"),
        ("Trend", "趨勢", "趋势"),
        ("On", "開啟", "开启"),
        ("Off", "關閉", "关闭"),
        ("Best", "最佳", "最佳"),
        ("SMA", "SMA", "SMA"),
        ("RSI", "RSI", "RSI"),
        ("WT", "WT", "WT"),
        ("CCI", "CCI", "CCI"),
        ("ADX", "ADX", "ADX"),
        ("k-nearest neighbours regime classifier adapted from capissimo's PineScript. It supports RSI, ROC, CCI, volume, or blended feature pairs and treats bearish and clear states as exits in this app.", "改編自 capissimo PineScript 的 k 最近鄰狀態分類器，支援 RSI、ROC、CCI、成交量或混合特徵組合，並在此應用程式中將看跌及清晰狀態視為退出。", "改编自 capissimo PineScript 的 k 近邻状态分类器，支持 RSI、ROC、CCI、成交量或混合特征组合，并在此应用程序中将看跌及清晰状态视为退出。"),
        ("Lorentzian-distance approximate nearest-neighbour classifier adapted from jdehorty's PineScript, with configurable feature engineering, filters, and kernel-based exit logic.", "改編自 jdehorty PineScript 的 Lorentzian 距離近似最近鄰分類器，提供可設定的特徵工程、篩選器及基於 Kernel 的退出邏輯。", "改编自 jdehorty PineScript 的 Lorentzian 距离近似最近邻分类器，提供可配置的特征工程、筛选器及基于 Kernel 的退出逻辑。"),
        ("Buys below the lower grid line and sells above the upper grid line.", "在較低網格線下方買入，並在較高網格線上方賣出。", "在较低网格线下方买入，并在较高网格线上方卖出。"),
        ("Chooses the first feature fed into the model. Each feature captures a different kind of market behaviour.", "選擇輸入模型的第一個特徵。每個特徵捕捉不同類型的市場行為。", "选择输入模型的第一个特征。每个特征捕捉不同类型的市场行为。"),
        ("Chooses the fourth feature used by the classifier.", "選擇分類器使用的第四個特徵。", "选择分类器使用的第四个特征。"),
        ("Chooses the optional fifth feature used when Feature Count is set to 5.", "選擇在特徵數量設為 5 時使用的可選第五個特徵。", "选择在特征数量设为 5 时使用的可选第五个特征。"),
        ("Chooses the second feature fed into the model so it can compare more than one market signal at once.", "選擇輸入模型的第二個特徵，讓模型可以同時比較多於一個市場訊號。", "选择输入模型的第二个特征，让模型可以同时比较多个市场信号。"),
        ("Chooses the third feature used by the classifier.", "選擇分類器使用的第三個特徵。", "选择分类器使用的第三个特征。"),
        ("Chooses whether the final factor comes from the best, middle, or weakest performance cluster.", "選擇最終因子來自表現最佳、中等或最弱的叢集。", "选择最终因子来自表现最佳、中等或最弱的簇。"),
        ("Chooses which feature pair the kNN model compares. 'All' blends every supported feature into one average view.", "選擇 kNN 模型比較的特徵組合。「全部」會將所有支援的特徵混合為一個平均視圖。", "选择 kNN 模型比较的特征组合。「全部」会将所有支持的特征混合为一个平均视图。"),
        ("Chooses which price series the model studies. Close is the simplest option, while HLC3 and OHLC4 smooth price using more of each bar.", "選擇模型研究的價格序列。收市價是最簡單的選項，而 HLC3 及 OHLC4 會使用每根柱的更多資料來平滑價格。", "选择模型研究的价格序列。收盘价是最简单的选项，而 HLC3 及 OHLC4 会使用每根 K 线的更多数据来平滑价格。"),
        ("Controls how quickly the performance score forgets older bars. Lower values react faster to recent changes.", "控制表現分數淡忘較舊柱的速度。數值越低，對近期變化的反應越快。", "控制表现分数淡忘较旧 K 线的速度。数值越低，对近期变化的反应越快。"),
        ("Lets the strategy close trades early when the trend estimate weakens, instead of always waiting for the fixed holding rule.", "當趨勢估計轉弱時允許策略提早平倉，而不是一直等待固定持倉規則。", "当趋势估计转弱时允许策略提前平仓，而不是一直等待固定持仓规则。"),
        ("Only allows trades when the short-term volatility check says the market is active enough.", "只有在短期波動率檢查顯示市場足夠活躍時才允許交易。", "只有在短期波动率检查显示市场足够活跃时才允许交易。"),
        ("Only allows long trades above the EMA and short signals below it when switched on.", "啟用時，只允許在 EMA 上方進行多頭交易及在其下方發出空頭訊號。", "启用时，只允许在 EMA 上方进行多头交易及在其下方发出空头信号。"),
        ("Only allows trades that agree with the SMA trend check when switched on.", "啟用時，只允許符合 SMA 趨勢檢查結果的交易。", "启用时，只允许符合 SMA 趋势检查结果的交易。"),
        ("Only allows trades when the regime test says price action is trending rather than drifting sideways.", "只有在狀態測試顯示價格走勢正在趨勢化而非橫向漂移時才允許交易。", "只有在状态测试显示价格走势正在趋势化而非横向漂移时才允许交易。"),
        ("Only allows trades when ADX is strong enough to suggest a trend is present.", "只有在 ADX 足夠強、顯示存在趨勢時才允許交易。", "只有在 ADX 足够强、显示存在趋势时才允许交易。"),
        ("Requires the kernel trend estimate to agree with the machine learning signal before the strategy trades.", "策略交易前，要求 Kernel 趨勢估計與機器學習訊號一致。", "策略交易前，要求 Kernel 趋势估计与机器学习信号一致。"),
        ("Selects a simple or exponential moving center for the grid.", "選擇網格使用簡單或指數移動中心線。", "选择网格使用简单或指数移动中心线。"),
        ("Sets how many bars are used to measure recent price movement. Higher values make the stop line steadier.", "設定用於衡量近期價格變動的柱數。數值越高，止損線越穩定。", "设置用于衡量近期价格变动的 K 线数量。数值越高，止损线越稳定。"),
        ("Sets how many engineered features are fed into the Lorentzian distance model. More features add context but can make the model slower and more selective.", "設定輸入 Lorentzian 距離模型的工程特徵數量。更多特徵會增加情境資訊，但可能令模型更慢及更具選擇性。", "设置输入 Lorentzian 距离模型的工程特征数量。更多特征会增加场景信息，但可能使模型更慢且更具选择性。"),
        ("Sets how many grid intervals above the center trigger an exit.", "設定中心線上方觸發退出的網格間隔數量。", "设置中心线上方触发退出的网格间隔数量。"),
        ("Sets how many grid intervals below the center trigger an entry.", "設定中心線下方觸發進場的網格間隔數量。", "设置中心线下方触发入场的网格间隔数量。"),
        ("Sets how many nearby historical matches vote on the next move. Lower values react faster but can be noisier.", "設定有多少個鄰近歷史匹配項為下一步走勢投票。數值越低，反應越快但雜訊可能越多。", "设置有多少个邻近历史匹配项为下一步走势投票。数值越低，反应越快但噪声可能越多。"),
        ("Sets how many recent bars the kernel estimate studies at one time.", "設定 Kernel 估計每次研究的近期柱數。", "设置 Kernel 估计每次研究的近期 K 线数量。"),
        ("Sets how many recent bars the strategy can use while tuning the factor. Lower values reduce workload but use less history.", "設定策略調校因子時可使用的近期柱數。數值越低，工作量越少但使用的歷史資料也越少。", "设置策略调校因子时可使用的近期 K 线数量。数值越低，工作量越少但使用的历史数据也越少。"),
        ("Sets how much history the model is allowed to search. More bars give broader context but cost more time to process.", "設定模型可搜尋的歷史資料量。柱數越多，情境越廣但處理時間越長。", "设置模型可搜索的历史数据量。K 线越多，场景越广但处理时间越长。"),
        ("Sets how strict the regime filter is. Higher values demand clearer trend conditions before the model can trade.", "設定狀態篩選器的嚴格程度。數值越高，模型交易前要求的趨勢條件越清晰。", "设置状态筛选器的严格程度。数值越高，模型交易前要求的趋势条件越清晰。"),
        ("Sets how strongly the kernel favours nearby bars over older ones. Lower values lean more on longer-term structure.", "設定 Kernel 偏重鄰近柱而非較舊柱的程度。數值越低，越依賴長期結構。", "设置 Kernel 偏重邻近 K 线而非较旧 K 线的程度。数值越低，越依赖长期结构。"),
        ("Sets how tightly the kernel line follows price. Lower values hug price more closely.", "設定 Kernel 線跟隨價格的緊密程度。數值越低，越貼近價格。", "设置 Kernel 线跟随价格的紧密程度。数值越低，越贴近价格。"),
        ("Sets the base neighbour pool used before the square-root rule picks the final k.", "設定平方根規則選出最終 k 值前使用的基礎鄰居池。", "设置平方根规则选出最终 k 值前使用的基础邻居池。"),
        ("Sets the base neighbour pool used before the square-root rule picks the final k. Larger values make the classifier look further back.", "設定平方根規則選出最終 k 值前使用的基礎鄰居池。數值越大，分類器回看得越遠。", "设置平方根规则选出最终 k 值前使用的基础邻居池。数值越大，分类器回看得越远。"),
        ("Sets the EMA lookback used by the EMA trend filter.", "設定 EMA 趨勢篩選器使用的 EMA 回看期。", "设置 EMA 趋势筛选器使用的 EMA 回看期。"),
        ("Sets the fast lookback window for the selected feature.", "設定所選特徵的快速回看視窗。", "设置所选特征的快速回看窗口。"),
        ("Sets the fast lookback window for the selected feature. Smaller values react more quickly to new price moves.", "設定所選特徵的快速回看視窗。數值越小，對新的價格變動反應越快。", "设置所选特征的快速回看窗口。数值越小，对新的价格变动反应越快。"),
        ("Sets the gap between tested factor values. Smaller steps check more candidates but take longer to evaluate.", "設定測試因子值之間的間距。步長越小，檢查的候選值越多但評估時間越長。", "设置测试因子值之间的间距。步长越小，检查的候选值越多但评估时间越长。"),
        ("Sets the highest SuperTrend multiplier to test. Larger values keep the stop line further away from price.", "設定要測試的最高 SuperTrend 倍數。數值越大，止損線與價格距離越遠。", "设置要测试的最高 SuperTrend 倍数。数值越大，止损线与价格距离越远。"),
        ("Sets the lag used when the smoothed kernel crossover is checked. Lower values react earlier.", "設定檢查平滑 Kernel 交叉時使用的延遲。數值越低，反應越早。", "设置检查平滑 Kernel 交叉时使用的延迟。数值越低，反应越早。"),
        ("Sets the lowest SuperTrend multiplier to test. Smaller values keep the stop line closer to price.", "設定要測試的最低 SuperTrend 倍數。數值越小，止損線與價格距離越近。", "设置要测试的最低 SuperTrend 倍数。数值越小，止损线与价格距离越近。"),
        ("Sets the main lookback period for Feature 1.", "設定特徵 1 的主要回看期。", "设置特征 1 的主要回看期。"),
        ("Sets the main lookback period for Feature 2.", "設定特徵 2 的主要回看期。", "设置特征 2 的主要回看期。"),
        ("Sets the main lookback period for Feature 3.", "設定特徵 3 的主要回看期。", "设置特征 3 的主要回看期。"),
        ("Sets the main lookback period for Feature 4.", "設定特徵 4 的主要回看期。", "设置特征 4 的主要回看期。"),
        ("Sets the main lookback period for Feature 5.", "設定特徵 5 的主要回看期。", "设置特征 5 的主要回看期。"),
        ("Sets the maximum holding length in bars before clearing the position.", "設定清除持倉前允許的最大持倉柱數。", "设置清除持仓前允许的最大持仓 K 线数量。"),
        ("Sets the maximum holding length in bars before the strategy clears the position.", "設定策略清除持倉前允許的最大持倉柱數。", "设置策略清除持仓前允许的最大持仓 K 线数量。"),
        ("Sets the maximum number of clustering passes on each run. Higher values give the clusters more chances to settle.", "設定每次執行的最大叢集迭代次數。數值越高，叢集有更多機會穩定下來。", "设置每次运行的最大聚类迭代次数。数值越高，簇有更多机会稳定下来。"),
        ("Sets the minimum ADX score needed when the ADX filter is on. Higher values require a stronger trend.", "設定啟用 ADX 篩選器時所需的最低 ADX 分數。數值越高，要求的趨勢越強。", "设置启用 ADX 筛选器时所需的最低 ADX 分数。数值越高，要求的趋势越强。"),
        ("Sets the number of bars used for the fast moving average. Lower values react faster and create more signals.", "設定快速移動平均線使用的柱數。數值越低，反應越快並產生更多訊號。", "设置快速移动平均线使用的 K 线数量。数值越低，反应越快并产生更多信号。"),
        ("Sets the number of bars used for the slow moving average. Higher values smooth more of the day-to-day noise.", "設定慢速移動平均線使用的柱數。數值越高，越能平滑日常雜訊。", "设置慢速移动平均线使用的 K 线数量。数值越高，越能平滑日常噪声。"),
        ("Sets the rolling average used as the center of the grid.", "設定用作網格中心的滾動平均線。", "设置用作网格中心的滚动平均线。"),
        ("Sets the secondary tuning value for Feature 1 when that indicator uses one.", "設定特徵 1 所用指標的次要調校值（如適用）。", "设置特征 1 所用指标的次要调校值（如适用）。"),
        ("Sets the secondary tuning value for Feature 2 when that indicator uses one.", "設定特徵 2 所用指標的次要調校值（如適用）。", "设置特征 2 所用指标的次要调校值（如适用）。"),
        ("Sets the secondary tuning value for Feature 3 when that indicator uses one.", "設定特徵 3 所用指標的次要調校值（如適用）。", "设置特征 3 所用指标的次要调校值（如适用）。"),
        ("Sets the secondary tuning value for Feature 4 when that indicator uses one.", "設定特徵 4 所用指標的次要調校值（如適用）。", "设置特征 4 所用指标的次要调校值（如适用）。"),
        ("Sets the secondary tuning value for Feature 5 when that indicator uses one.", "設定特徵 5 所用指標的次要調校值（如適用）。", "设置特征 5 所用指标的次要调校值（如适用）。"),
        ("Sets the slow lookback window for the selected feature.", "設定所選特徵的慢速回看視窗。", "设置所选特征的慢速回看窗口。"),
        ("Sets the slow lookback window for the selected feature. Larger values smooth more short-term noise.", "設定所選特徵的慢速回看視窗。數值越大，越能平滑短期雜訊。", "设置所选特征的慢速回看窗口。数值越大，越能平滑短期噪声。"),
        ("Sets the SMA lookback used by the SMA trend filter.", "設定 SMA 趨勢篩選器使用的 SMA 回看期。", "设置 SMA 趋势筛选器使用的 SMA 回看期。"),
        ("Sets the smoothing period for the signal line. This controls how quickly MACD crossovers are confirmed.", "設定訊號線的平滑週期。這會控制 MACD 交叉獲確認的速度。", "设置信号线的平滑周期。这会控制 MACD 交叉获得确认的速度。"),
        ("Turns the ATR filter on or off.", "開啟或關閉 ATR 篩選器。", "开启或关闭 ATR 筛选器。"),
        ("Turns the ATR filter on or off. When on, the strategy only trades when short-term volatility is stronger than the slower baseline.", "開啟或關閉 ATR 篩選器。開啟時，策略只會在短期波動率強於較慢基準時交易。", "开启或关闭 ATR 筛选器。开启时，策略只会在短期波动率强于较慢基准时交易。"),
        ("Uses the smoother crossover version of the kernel signal. This usually cuts down the number of colour changes and trade flips.", "使用 Kernel 訊號較平滑的交叉版本。這通常會減少顏色變化及交易翻轉次數。", "使用 Kernel 信号更平滑的交叉版本。这通常会减少颜色变化及交易翻转次数。"),
    )
)

DEFAULT_TRANSLATION_ROWS = DEFAULT_TRANSLATION_ROWS + SETTINGS_TRANSLATION_ROWS


TRANSLATION_KEY_ALIASES = {
    "Export image": "Export images",
    "简体中文（中国大陆）": "简体中文(中国大陆)",
}


@dataclass(frozen=True)
class LanguageSettings:
    language: LanguageCode = DEFAULT_LANGUAGE_CODE
    translations: tuple[dict[str, str], ...] = DEFAULT_TRANSLATION_ROWS
    history: tuple[dict[str, object], ...] = ()


def normalize_language_code(value: str | None) -> LanguageCode:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in {"zh_hant", "zh_hk", "zh_hant_hk"}:
        return "zh_hant_hk"
    if normalized in {"zh_hans", "zh_cn", "zh_hans_cn"}:
        return "zh_hans_cn"
    if normalized in {"en", "en_us", "english"}:
        return "en"
    return DEFAULT_LANGUAGE_CODE


def _normalize_translation_rows(value: Any) -> tuple[dict[str, str], ...]:
    rows = value if isinstance(value, list) else []
    normalized_rows: list[dict[str, str]] = []
    seen_english: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        english = str(row.get("en", "")).strip()
        english = TRANSLATION_KEY_ALIASES.get(english, english)
        if not english or english in seen_english:
            continue
        normalized_rows.append(
            {
                "en": english,
                "zh_hant_hk": str(row.get("zh_hant_hk", "")).strip(),
                "zh_hans_cn": str(row.get("zh_hans_cn", "")).strip(),
            }
        )
        seen_english.add(english)
    for row in DEFAULT_TRANSLATION_ROWS:
        english = row["en"]
        if english not in seen_english:
            normalized_rows.append(dict(row))
            seen_english.add(english)
    return tuple(sorted(normalized_rows, key=lambda row: row["en"].casefold()))


def _normalize_history_entries(value: Any) -> tuple[dict[str, object], ...]:
    rows = value if isinstance(value, list) else []
    normalized_rows: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        timestamp = str(row.get("timestamp", "")).strip()
        changes = row.get("changes", [])
        if not timestamp or not isinstance(changes, list):
            continue
        clean_changes = [str(change).strip() for change in changes if str(change).strip()]
        if clean_changes:
            normalized_rows.append(
                {
                    "timestamp": timestamp,
                    "source": str(row.get("source", "")).strip(),
                    "changes": clean_changes,
                }
            )
    return tuple(normalized_rows[-200:])


def _current_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def diff_translation_rows(
    previous_rows: tuple[dict[str, str], ...],
    next_rows: tuple[dict[str, str], ...],
) -> list[str]:
    previous = {row["en"]: row for row in previous_rows}
    next_map = {row["en"]: row for row in next_rows}
    changes: list[str] = []
    for english in sorted(set(previous) | set(next_map), key=str.casefold):
        old_row = previous.get(english)
        next_row = next_map.get(english)
        if old_row is None and next_row is not None:
            changes.append(f"Added {english}")
            continue
        if old_row is not None and next_row is None:
            changes.append(f"Removed {english}")
            continue
        if old_row is None or next_row is None:
            continue
        field_changes = []
        for field_name, field_label in (("zh_hant_hk", "繁體中文（香港）"), ("zh_hans_cn", "简体中文(中国大陆)")):
            old_value = old_row.get(field_name, "")
            next_value = next_row.get(field_name, "")
            if old_value != next_value:
                field_changes.append(f"{field_label}: {old_value or 'blank'} -> {next_value or 'blank'}")
        if field_changes:
            changes.append(f"{english}: {'; '.join(field_changes)}")
    return changes


def load_language_settings() -> LanguageSettings:
    try:
        payload = load_settings_section("language")
    except OSError:
        return LanguageSettings()
    return LanguageSettings(
        language=normalize_language_code(payload.get("language")),
        translations=_normalize_translation_rows(payload.get("translations")),
        history=_normalize_history_entries(payload.get("history")),
    )


def save_language_settings(
    *,
    language: str | None = None,
    translations: list[dict[str, str]] | None = None,
    history_label: str = "Manual edit",
) -> LanguageSettings:
    current = load_language_settings()
    next_translations = _normalize_translation_rows(translations if translations is not None else list(current.translations))
    changes = diff_translation_rows(current.translations, next_translations) if translations is not None else []
    next_history = list(current.history)
    if changes:
        next_history.append(
            {
                "timestamp": _current_timestamp(),
                "source": history_label,
                "changes": changes,
            }
        )
    next_settings = LanguageSettings(
        language=normalize_language_code(language or current.language),
        translations=next_translations,
        history=_normalize_history_entries(next_history),
    )
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)
    save_settings_section(
        "language",
        {
            "language": next_settings.language,
            "translations": list(next_settings.translations),
            "history": list(next_settings.history),
        },
    )
    return next_settings


def save_language_code(value: str) -> LanguageCode:
    return save_language_settings(language=value).language


def build_translation_map(settings: LanguageSettings | None = None) -> dict[str, dict[str, str]]:
    current = settings or load_language_settings()
    return {row["en"]: dict(row) for row in current.translations}


def translate_text(value: str, language: LanguageCode, translations: dict[str, dict[str, str]]) -> str:
    if language == "en":
        return value
    row = translations.get(value)
    if not row:
        return value
    return row.get(language) or value


def translate_nested_text(
    value: Any,
    language: LanguageCode,
    translations: dict[str, dict[str, str]],
) -> Any:
    """Translate matching string values inside a Settings payload."""
    if isinstance(value, str):
        return translate_text(value, language, translations)
    if isinstance(value, list):
        return [translate_nested_text(item, language, translations) for item in value]
    if isinstance(value, tuple):
        return tuple(translate_nested_text(item, language, translations) for item in value)
    if isinstance(value, Mapping):
        return {
            key: translate_nested_text(item, language, translations)
            for key, item in value.items()
        }
    return value


def translate_labels(labels: dict[str, str], settings: LanguageSettings) -> dict[str, str]:
    translations = build_translation_map(settings)
    return {
        key: translate_text(str(value), settings.language, translations)
        for key, value in labels.items()
    }
