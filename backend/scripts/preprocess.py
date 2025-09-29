#!/usr/bin/env python3
# Lightweight preprocessing utilities used by train.py and predict.py
from typing import Tuple, List
import pandas as pd


def basic_preprocess(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """Return (df_processed, categorical_columns)"""
    d = df.copy()
    # Fillna simple
    d = d.fillna('')
    cat_cols = [c for c in d.columns if d[c].dtype == object]
    return d, cat_cols
