#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从「美承影院线下券绑定信息.csv」读取券状态=未使用的行，生成 INSERT 进 coupon_instance 的 SQL。
用法: python3 csv_to_coupon_sql.py [csv路径] [输出sql路径]
默认: 美承影院线下券绑定信息.csv 在脚本同目录或 Desktop，输出到 docs/coupon_instance-直接导入.sql
"""

import csv
import os
import sys

# 默认路径
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_CSV = os.path.join(os.path.expanduser("~/Desktop"), "美承影院线下券绑定信息.csv")
DEFAULT_SQL = os.path.join(PROJECT_ROOT, "docs", "coupon_instance-直接导入.sql")

TENANT_ID = "5f3c8e2a-9b4d-4f7a-8c21-6d2a1e9b73c4"
TEMPLATE_ID = 1
BATCH_SIZE = 200  # 每批 INSERT 行数，避免单条 SQL 过长


def esc(s):
    if s is None:
        return "NULL"
    t = (s or "").strip().replace("\\", "\\\\").replace("'", "''")
    return "'" + t + "'"


def parse_validity(val):
    val = (val or "").strip()
    if "~" in val:
        parts = [p.strip() for p in val.split("~", 1)]
        from_ = (parts[0] or "").strip() + " 00:00:00+08"
        to_ = (parts[1] or "").strip() + " 23:59:59+08"
        return from_, to_
    return "NULL", "NULL"


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SQL

    if not os.path.isfile(csv_path):
        print("CSV 不存在:", csv_path)
        sys.exit(1)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    rows = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("CSV 无表头")
            sys.exit(1)
        for row in reader:
            status = (row.get("券状态") or "").strip()
            if status != "未使用":
                continue
            code = (row.get("券号") or "").strip()
            if not code:
                continue
            phone = (row.get("用户手机号") or "").strip()
            valid_str = (row.get("有效期") or "").strip()
            valid_from, valid_to = parse_validity(valid_str)
            rows.append((code, phone, valid_from, valid_to))

    print("未使用券条数:", len(rows))

    with open(out_path, "w", encoding="utf-8") as out:
        out.write("-- 从 CSV 直接生成的 INSERT，仅「券状态=未使用」\n")
        out.write("-- 执行前请把 template_id 的 1 改为你库里 coupon_template 的 id\n")
        out.write("-- 重复券号会因 ON CONFLICT 跳过\n\n")

        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i : i + BATCH_SIZE]
            out.write(
                "INSERT INTO public.coupon_instance (\n"
                "  tenant_id, template_id, coupon_code, coupon_serial, source_type,\n"
                "  status, valid_from, valid_to, phone, created_at, updated_at\n"
                ") VALUES\n"
            )
            values = []
            for code, phone, vf, vt in batch:
                vf_sql = esc(vf) if vf != "NULL" else "NULL"
                vt_sql = esc(vt) if vt != "NULL" else "NULL"
                values.append(
                    "  (%s::uuid, %s::bigint, %s, %s, 'import', 'available', %s::timestamptz, %s::timestamptz, %s, now(), now())"
                    % (esc(TENANT_ID), TEMPLATE_ID, esc(code), esc(code), vf_sql, vt_sql, esc(phone) if phone else "NULL")
                )
            out.write(",\n".join(values))
            out.write("\nON CONFLICT (coupon_code) DO NOTHING;\n\n")

    print("已写入:", out_path)


if __name__ == "__main__":
    main()
