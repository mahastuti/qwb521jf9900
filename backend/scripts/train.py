#!/usr/bin/env python3
import os
import sys
import json
import argparse
from pathlib import Path

# Minimal training script using pandas + scikit-learn + catboost
# Expects either TRAIN_CSV env var path or TRAIN_QUERY + DATABASE_URL to read from DB

try:
    import pandas as pd
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score
    from sklearn.ensemble import RandomForestClassifier
    import joblib
    # CatBoost optional
    try:
        from catboost import CatBoostClassifier
        HAS_CATBOOST = True
    except Exception:
        HAS_CATBOOST = False
except Exception as e:
    print(json.dumps({"error": f"Missing python dependencies: {e}"}))
    sys.exit(2)


def load_data(args):
    csv = os.environ.get('TRAIN_CSV') or args.csv
    if csv and Path(csv).exists():
        df = pd.read_csv(csv)
        return df
    db_url = os.environ.get('DATABASE_URL')
    query = os.environ.get('TRAIN_QUERY') or args.query
    if db_url and query:
        try:
            from sqlalchemy import create_engine
            engine = create_engine(db_url)
            df = pd.read_sql_query(query, engine)
            return df
        except Exception as e:
            print(json.dumps({"error": f"Failed to read from DB: {e}"}))
            sys.exit(2)
    print(json.dumps({"error": "No TRAIN_CSV or (DATABASE_URL + TRAIN_QUERY) provided"}))
    sys.exit(2)


def preprocess(df, model_type='catboost'):
    df = df.copy()
    # If user uses different column name for target, try 'strike' fallback
    if 'target' not in df.columns and 'strike' in df.columns:
        df = df.rename(columns={'strike': 'target'})
    if 'target' not in df.columns:
        print(json.dumps({"error": "Data must include 'target' column (or 'strike')"}))
        sys.exit(2)
    df = df.dropna(subset=['target'])

    # User-provided RF flow: drop these if present
    cols_to_drop = ["strike", "tanggal_fix", "jam", "tahun", "tanggal", "bulan"]
    cols_present_to_drop = [c for c in cols_to_drop if c in df.columns]
    if cols_present_to_drop:
        df = df.drop(columns=cols_present_to_drop)

    # One-hot encoding for waktu, cuaca, fase if present
    ohe_cols = [c for c in ['waktu', 'cuaca', 'fase'] if c in df.columns]
    if model_type == 'random_forest' and ohe_cols:
        try:
            df = pd.get_dummies(df, columns=ohe_cols, drop_first=True)
        except Exception as e:
            print(json.dumps({"error": f"get_dummies failed: {e}"}))
            sys.exit(2)

    # Fill missing values
    df = df.fillna(0)

    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', help='Path to training CSV')
    parser.add_argument('--query', help='SQL query to load data')
    parser.add_argument('--output', help='Output model path', default='backend/models/model.pkl')
    parser.add_argument('--test-size', type=float, default=0.2)
    parser.add_argument('--model', choices=['catboost', 'random_forest'], default='catboost')
    args = parser.parse_args()

    model_type = args.model or os.environ.get('MODEL_TYPE', 'catboost')

    df = load_data(args)
    df = preprocess(df, model_type=model_type)

    if 'target' not in df.columns:
        print(json.dumps({"error": "No target column after preprocessing"}))
        sys.exit(2)

    X = df.drop(columns=['target'])
    y = df['target']

    try:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=args.test_size, stratify=y if len(y.unique())>1 else None, random_state=42)
    except Exception:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=args.test_size, random_state=42)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if model_type == 'random_forest':
        try:
            model = RandomForestClassifier(n_estimators=200, random_state=42, class_weight='balanced_subsample', n_jobs=-1)
            model.fit(X_train, y_train)
            # Save via joblib (use .pkl)
            if out_path.suffix.lower() not in ['.pkl', '.joblib']:
                out_path = out_path.with_suffix('.pkl')
            joblib.dump(model, str(out_path))
            save_info = {'model_path': str(out_path), 'type': 'random_forest'}
        except Exception as e:
            print(json.dumps({"error": f"RandomForest training failed: {e}"}))
            sys.exit(2)
    else:
        if not HAS_CATBOOST:
            print(json.dumps({"error": "CatBoost is not installed. Install catboost or use --model random_forest"}))
            sys.exit(2)
        try:
            model = CatBoostClassifier(iterations=200, learning_rate=0.1, depth=6, verbose=False)
            # For catboost, try to detect categorical by object dtypes
            cat_cols = [c for c in X_train.columns if X_train[c].dtype == object]
            # CatBoost expects cat_features as column names or indices; pass names
            model.fit(X_train, y_train, cat_features=cat_cols if cat_cols else None)
            # Ensure CatBoost model saved as .cbm
            if out_path.suffix.lower() != '.cbm':
                out_path = out_path.with_suffix('.cbm')
            model.save_model(str(out_path))
            save_info = {'model_path': str(out_path), 'type': 'catboost'}
        except Exception as e:
            print(json.dumps({"error": f"CatBoost training failed: {e}"}))
            sys.exit(2)

    # evaluate
    try:
        if hasattr(model, 'predict_proba'):
            probs = model.predict_proba(X_test)[:, 1]
            auc = float(roc_auc_score(y_test, probs))
        else:
            preds = model.predict(X_test)
            auc = None
    except Exception:
        auc = None

    result = {"model_path": str(out_path), "auc": auc}
    result.update(save_info if 'save_info' in locals() else {})
    print(json.dumps(result))

if __name__ == '__main__':
    main()
