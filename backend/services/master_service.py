"""Master Traders & Futures Delivery Slips Service for Retraq."""

import json
from typing import Optional

from sqlalchemy import desc, asc
from sqlalchemy.orm import Session

from models import MasterTrader, MasterPosition
from services.symbol_utils import normalize_symbol, is_valid_symbol

CONTRACT_MASTER_QUOTES = [
    {
        "id": "bitking",
        "author": "比特皇 (Bitking)",
        "title": "大资金合约复利心法与风控铁律",
        "tags": ["低杠杆", "风控铁律", "右侧顺势", "复利"],
        "summary": "从几万到数亿的合约传奇，核心在于大资金低杠杆运作与极致确定性时下注。",
        "quotes": [
            "合约不是暴利暴富的赌博工具，而是放大确定性行情的加速器。用20倍以上高杠杆的人，无论赚过多少次，终究会在一次黑天鹅插针中清零。",
            "永远不要在下跌趋势中因为‘跌了太多’就去抄底，也不要在主升浪中因为‘涨了太高’就去摸顶做空。顺势而为，不猜顶底。",
            "开仓前，先计算好该笔交易的最大可承受亏损金额。如果止损金额会影响你的心态或睡眠，立刻降低仓位！",
            "暴利靠耐心等待大级别趋势；大部分震荡烂行情里，空仓观望是最顶级的交易能力。",
        ],
    },
    {
        "id": "tony",
        "author": "Tony (《交易之王》)",
        "title": "裸K突破、盈亏比与截断亏损",
        "tags": ["高盈亏比", "裸K突破", "截断亏损", "趋势跟踪"],
        "summary": "建立不对称风险收益比系统，用极小的试错成本博取大级别主升空间。",
        "quotes": [
            "顺大势，逆小势。在大级别多头趋势中，只在小级别回踩支撑企稳时做多；大级别空头趋势中，只在小级别反弹遇阻时做空。",
            "合约成功的秘诀不是预测未来，而是建立不对称风险收益比。用1%的试错成本，去搏5%~10%的主升空间。",
            "止损是你在合约市场活下去的唯一门票。不要对市场抱有幻想，逻辑破位就无条件离场。",
            "浮盈才是最好的加仓资金。开仓盈利并脱离成本区后，才考虑顺势加仓，永不在亏损时逆势补仓摊薄成本。",
        ],
    },
    {
        "id": "aoying",
        "author": "熬鹰 (AllInCrypto)",
        "title": "从负债爆仓到年赚4000万的实战蜕变",
        "tags": ["防爆仓", "情绪管理", "回撤停手", "仓位管理"],
        "summary": "从惨痛爆仓中重生的合约心法：严格分仓、绝不扛单、杜绝报复性交易。",
        "quotes": [
            "爆仓只有两个原因：仓位过重、不设止损。只要管住这两点，在币圈你已经跑赢了90%的交易者。",
            "当你连续亏损2~3笔时，必须强制自己关电脑停手。不要在情绪激动时‘报复性开单’，那是爆仓的最快路径。",
            "赚钱靠行情给赏饭吃，保本靠钢铁般的纪律。好行情敢于重仓拿住，震荡垃圾行情轻仓试错甚至空仓观望。",
            "交易是长跑，活得久比赚得快重要100倍。控制住单次回撤，资金曲线才能走出健康的长牛走势。",
        ],
    },
    {
        "id": "yuyu",
        "author": "予与",
        "title": "裸K关键位狙击与三次爆仓重生",
        "tags": ["裸K狙击", "假突破识别", "关键支撑阻力", "高盈亏比"],
        "summary": "1年9个月从5万到1亿的实战经验：摒弃一切杂乱指标，死盯裸K关键位与盈亏比。",
        "quotes": [
            "不看任何杂乱指标，盘面价格和K线结构就是最真实的市场语言。密集成交区、颈线位就是多空争夺的生死线。",
            "高胜率往往是陷阱，高盈亏比才是真谛。抓到一次真突破，就要让浮盈奔跑，不要在赚了一点点就匆忙止盈。",
            "假突破往往孕育着反向的真主升浪。当价格跌破关键支撑却迅速强力收回，就是最凶悍的多头买点。",
        ],
    },
    {
        "id": "longwang",
        "author": "憨巴龙王",
        "title": "合约本质思考：在多空博弈中生存更久",
        "tags": ["多空思维", "博弈认知", "周期敬畏", "阻力最小方向"],
        "summary": "合约是高烈度零和博弈，寻找市场阻力最小的方向，等待对手盘犯错。",
        "quotes": [
            "合约是高烈度博弈，你赚的每一分钱都是另一个犯错交易者的本金。所以要等市场出现结构性错误，而不是自己频繁去犯错。",
            "多空只是一念之间，顺应阻力最小的方向。牛市主升浪不做逆势空，熊市阴跌不做抄底多，震荡市不做大仓位。",
            "学会接受踏空，踏空不会亏钱，急躁盲目追高才会要命。",
        ],
    },
    {
        "id": "langlang",
        "author": "Bit浪浪",
        "title": "裸K四时春夏秋冬主升波段系统",
        "tags": ["春夏秋冬", "裸K波段", "顺势主升", "龙头策略"],
        "summary": "大级别定方向，小级别找买点；顺大盘天时，聚焦真龙头重仓出击。",
        "quotes": [
            "明确多头主升浪中，没有任何一笔空单；顺势前提是上方无密集套牢盘，距强阻力有足够空间。",
            "大级别定方向（日线/4H），小级别找买点（15m/5m）。只在大概率赚钱的结构上下注，逻辑失效立刻认赔。",
            "春天试仓布局，夏天聚焦真龙头重仓主升，秋天鱼尾收缩防守，冬天保住利润空仓休息。",
        ],
    },
]


class MasterService:
    @staticmethod
    def list_masters(
        db: Session,
        search: Optional[str] = None,
        has_positions_only: bool = True,
        sort_by: str = "roi",
        sort_order: str = "desc",
        page: int = 1,
        limit: int = 30,
    ) -> dict:
        q = db.query(MasterTrader).filter(MasterTrader.market == "futures")

        if has_positions_only:
            q = q.filter(MasterTrader.has_positions.is_(True))

        if search and search.strip():
            term = f"%{search.strip()}%"
            q = q.filter((MasterTrader.nickname.ilike(term)) | (MasterTrader.id.ilike(term)))

        sort_col = getattr(MasterTrader, sort_by, MasterTrader.roi)
        # Handle nulls
        if sort_order.lower() == "asc":
            q = q.order_by(asc(sort_col).nullslast())
        else:
            q = q.order_by(desc(sort_col).nullslast())

        total = q.count()
        rows = q.offset((page - 1) * limit).limit(limit).all()

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "data": [MasterService._trader_to_dict(t) for t in rows],
        }

    @staticmethod
    def get_master_detail(db: Session, trader_id: str) -> Optional[dict]:
        t = db.query(MasterTrader).filter(MasterTrader.id == trader_id).first()
        if not t:
            return None
        return MasterService._trader_to_dict(t, full=True)

    @staticmethod
    def get_master_positions(
        db: Session,
        trader_id: str,
        symbol: Optional[str] = None,
        side: Optional[str] = None,
        start_date: Optional[int] = None,
        end_date: Optional[int] = None,
        sort_by: str = "opened_at",
        sort_order: str = "desc",
        page: int = 1,
        limit: int = 50,
    ) -> dict:
        q = db.query(MasterPosition).filter(MasterPosition.trader_id == trader_id)

        if symbol and symbol.strip():
            norm_sym = normalize_symbol(symbol.strip())
            if is_valid_symbol(norm_sym):
                q = q.filter(MasterPosition.symbol == norm_sym)

        if side and side.strip():
            s = side.strip().upper()
            if s in ("LONG", "SHORT"):
                q = q.filter(MasterPosition.side == s)

        if start_date:
            q = q.filter(MasterPosition.opened_at >= start_date)
        if end_date:
            q = q.filter(MasterPosition.opened_at <= end_date)

        total = q.count()

        sort_col = getattr(MasterPosition, sort_by, MasterPosition.opened_at)
        if sort_order.lower() == "asc":
            q = q.order_by(asc(sort_col).nullslast())
        else:
            q = q.order_by(desc(sort_col).nullslast())

        rows = q.offset((page - 1) * limit).limit(limit).all()

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "data": [MasterService._position_to_dict(p) for p in rows],
        }

    @staticmethod
    def sync_trader_from_binance(db: Session, trader_id: str) -> dict:
        """Fetch latest profile details & contract position history directly from Binance live API."""
        import urllib.request
        import logging
        logger = logging.getLogger(__name__)

        trader = db.query(MasterTrader).filter(MasterTrader.id == trader_id).first()
        if not trader:
            raise ValueError("Master trader not found")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "clienttype": "web",
            "lang": "zh-CN",
        }

        # 1. Fetch profile detail from Binance
        try:
            detail_url = f"https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/detail?portfolioId={trader_id}"
            req = urllib.request.Request(detail_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=8) as resp:
                detail_json = json.loads(resp.read().decode("utf-8"))
                detail_data = detail_json.get("data") or {}
                if detail_data:
                    if detail_data.get("nickname"):
                        setattr(trader, "nickname", str(detail_data["nickname"]))
                    if detail_data.get("avatarUrl"):
                        setattr(trader, "avatar_url", str(detail_data["avatarUrl"]))
                    if detail_data.get("aumAmount") is not None:
                        setattr(trader, "aum", float(detail_data["aumAmount"]))
                    if detail_data.get("currentCopyCount") is not None:
                        setattr(trader, "current_copy_count", int(detail_data["currentCopyCount"]))
                    if detail_data.get("maxCopyCount") is not None:
                        setattr(trader, "max_copy_count", int(detail_data["maxCopyCount"]))
                    if detail_data.get("badgeName"):
                        setattr(trader, "badge", str(detail_data["badgeName"]))
                    if detail_data.get("sharpRatio") is not None:
                        setattr(trader, "sharp_ratio", float(detail_data["sharpRatio"]))
        except Exception as e:
            logger.warning("Failed to fetch Binance profile detail for %s: %s", trader_id, e)

        # 2. Fetch position history from Binance (page 1 and 2, up to 100 positions)
        new_positions_count = 0
        try:
            history_url = "https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/position-history"
            existing_pos_ids = set(
                row[0]
                for row in db.query(MasterPosition.position_id)
                .filter(MasterPosition.trader_id == trader_id)
                .filter(MasterPosition.position_id.isnot(None))
                .all()
            )
            existing_opened_times = set(
                row[0]
                for row in db.query(MasterPosition.opened_at)
                .filter(MasterPosition.trader_id == trader_id)
                .all()
            )

            for page_num in (1, 2):
                payload = {"portfolioId": trader_id, "pageNumber": page_num, "pageSize": 50}
                req = urllib.request.Request(history_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    history_json = json.loads(resp.read().decode("utf-8"))
                    items = (history_json.get("data") or {}).get("list") or []
                    if not items:
                        break
                    for item in items:
                        raw_pos_id = str(item.get("positionId") or item.get("id") or "")
                        raw_sym = str(item.get("symbol") or "")
                        norm_sym = normalize_symbol(raw_sym)
                        if not is_valid_symbol(norm_sym):
                            continue

                        opened = int(item.get("opened") or 0)
                        if raw_pos_id and raw_pos_id in existing_pos_ids:
                            continue
                        if opened and opened in existing_opened_times:
                            continue

                        side_str = "LONG" if "long" in str(item.get("side", "")).lower() else "SHORT"
                        closed = int(item.get("closed") or item.get("updateTime") or 0)
                        entry_p = float(item.get("avgCost") or 0.0)
                        close_p = float(item.get("avgClosePrice") or 0.0)
                        pnl_val = float(item.get("closingPnl") or 0.0)

                        raw_roi = float(item.get("roi") or 0.0)
                        roi_val = raw_roi * 100.0 if abs(raw_roi) < 10.0 else raw_roi

                        pos = MasterPosition(
                            position_id=raw_pos_id or None,
                            trader_id=trader_id,
                            symbol=norm_sym,
                            side=side_str,
                            leverage=float(item.get("leverage") or 20.0),
                            margin_mode=str(item.get("isolated") or "Cross"),
                            entry_price=entry_p,
                            close_price=close_p if close_p > 0 else None,
                            pnl=pnl_val,
                            roi=roi_val,
                            max_open_amount=float(item.get("maxOpenInterest") or 0.0),
                            closed_amount=float(item.get("closedVolume") or 0.0),
                            opened_at=opened,
                            closed_at=closed if closed > 0 else None,
                            status=str(item.get("status") or "All Closed"),
                        )
                        db.add(pos)
                        new_positions_count += 1
                        if raw_pos_id:
                            existing_pos_ids.add(raw_pos_id)
                        if opened:
                            existing_opened_times.add(opened)

            total_count = db.query(MasterPosition).filter(MasterPosition.trader_id == trader_id).count() + new_positions_count
            setattr(trader, "position_count", int(total_count))
            setattr(trader, "has_positions", bool(total_count > 0))
            db.commit()
        except Exception as e:
            logger.warning("Failed to fetch Binance position history for %s: %s", trader_id, e)
            db.commit()

        total_positions = db.query(MasterPosition).filter(MasterPosition.trader_id == trader_id).count()
        return {
            "success": True,
            "trader_id": trader_id,
            "new_count": new_positions_count,
            "total_positions": total_positions,
            "nickname": trader.nickname,
        }

    @staticmethod
    def get_overlay_actions(
        db: Session,
        symbol: str,
        start_ts: int,
        end_ts: int,
        limit: int = 300,
    ) -> list[dict]:
        norm_sym = normalize_symbol(symbol)
        if not is_valid_symbol(norm_sym):
            return []

        # Find positions for this symbol overlapping the time range
        # (opened between start and end, or closed between start and end)
        rows = (
            db.query(MasterPosition, MasterTrader.nickname, MasterTrader.avatar_url)
            .join(MasterTrader, MasterPosition.trader_id == MasterTrader.id)
            .filter(
                MasterPosition.symbol == norm_sym,
                MasterPosition.opened_at <= end_ts,
                (MasterPosition.closed_at.is_(None)) | (MasterPosition.closed_at >= start_ts),
            )
            .order_by(MasterPosition.opened_at.asc())
            .limit(limit)
            .all()
        )

        results = []
        for pos, nick, avatar in rows:
            results.append(
                {
                    "id": pos.id,
                    "position_id": pos.position_id,
                    "trader_id": pos.trader_id,
                    "trader_nickname": nick,
                    "trader_avatar": avatar,
                    "symbol": pos.symbol,
                    "side": pos.side,
                    "leverage": pos.leverage,
                    "margin_mode": pos.margin_mode,
                    "entry_price": pos.entry_price,
                    "close_price": pos.close_price,
                    "pnl": pos.pnl,
                    "roi": pos.roi,
                    "opened_at": pos.opened_at,
                    "closed_at": pos.closed_at,
                }
            )
        return results

    @staticmethod
    def get_quotes() -> list[dict]:
        return CONTRACT_MASTER_QUOTES

    @staticmethod
    def _trader_to_dict(t: MasterTrader, full: bool = False) -> dict:
        chart_data = []
        if t.equity_chart:
            try:
                chart_data = json.loads(str(t.equity_chart))
            except Exception:
                chart_data = []

        tags_data = []
        if t.tags:
            try:
                tags_data = json.loads(str(t.tags))
            except Exception:
                tags_data = []

        d = {
            "id": t.id,
            "nickname": t.nickname,
            "market": t.market,
            "avatar_url": t.avatar_url,
            "roi": t.roi,
            "pnl": t.pnl,
            "mdd": t.mdd,
            "win_rate": t.win_rate,
            "sharp_ratio": t.sharp_ratio,
            "aum": t.aum,
            "trading_days": t.trading_days,
            "current_copy_count": t.current_copy_count,
            "max_copy_count": t.max_copy_count,
            "badge": t.badge,
            "tags": tags_data,
            "equity_chart": chart_data,
            "detail_url": t.detail_url,
            "has_positions": t.has_positions,
            "position_count": t.position_count,
        }

        if full:
            if t.equity_chart_30d:
                try:
                    d["equity_chart_30d"] = json.loads(str(t.equity_chart_30d))
                except Exception:
                    d["equity_chart_30d"] = []
            if t.equity_chart_90d:
                try:
                    d["equity_chart_90d"] = json.loads(str(t.equity_chart_90d))
                except Exception:
                    d["equity_chart_90d"] = []

        return d

    @staticmethod
    def _position_to_dict(p: MasterPosition) -> dict:
        return {
            "id": p.id,
            "position_id": p.position_id,
            "trader_id": p.trader_id,
            "symbol": p.symbol,
            "side": p.side,
            "margin_mode": p.margin_mode,
            "leverage": p.leverage,
            "entry_price": p.entry_price,
            "close_price": p.close_price,
            "pnl": p.pnl,
            "roi": p.roi,
            "opened_at": p.opened_at,
            "closed_at": p.closed_at,
            "max_amount": p.max_amount,
            "closed_amount": p.closed_amount,
            "status": p.status,
        }


master_service = MasterService()
