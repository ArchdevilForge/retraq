#!/usr/bin/env python3
"""导入示例交易数据到数据库"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal, Base
from services.trade_importer import trade_importer
from models import Trade

def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # 检查是否已有数据
    existing = db.query(Trade).count()
    if existing > 0:
        print(f"📊 数据库已有 {existing} 条交易记录，跳过导入")
        db.close()
        return
    
    # 导入示例数据
    excel_path = os.path.join(os.path.dirname(__file__), "..", "1.xlsx")
    if not os.path.exists(excel_path):
        print("⚠️  未找到 1.xlsx，跳过数据导入")
        db.close()
        return
    
    print("📥 导入示例交易数据...")
    result = trade_importer.parse_excel(db, excel_path)
    print(f"✅ 导入完成: 成功 {result['success']} 条, 失败 {result['failed']} 条")
    db.close()

if __name__ == "__main__":
    main()
