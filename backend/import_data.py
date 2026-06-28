#!/usr/bin/env python3
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from migrate import ensure_database


def main():
    ensure_database()
    print("✅ Database ready (datasets)")


if __name__ == "__main__":
    main()