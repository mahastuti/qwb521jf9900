#!/usr/bin/env python3
import sys
import os
import json
from pathlib import Path

try:
    import pandas as pd
    from catboost import CatBoostClassifier, CatBoostRegressor
except Exception as e:
    print(json.dumps({"error": f"Missing python deps: {e}"}))
    sys.exit(2)

MODEL_PATH_ENV = os.environ.get('MODEL_PATH') or 'backend/models/model.pkl'

def load_input():
    try:
        raw = sys.stdin.read()
        if not raw:
            # try reading from argv
            if len(sys.argv) > 1:
                raw = sys.argv[1]
            else:
                raw = '{}'
        data = json.loads(raw)
        return data
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(2)


def main():
    data = load_input()
    model_path = os.environ.get('MODEL_PATH') or MODEL_PATH_ENV
    p = Path(model_path)
    if not p.exists():
        print(json.dumps({"error": f"Model file not found at {model_path}"}))
        sys.exit(2)

    model = None
    is_clf = True
    # Try CatBoost first
    try:
        model = CatBoostClassifier()
        model.load_model(str(p))
        is_clf = True
    except Exception:
        try:
            model = CatBoostRegressor()
            model.load_model(str(p))
            is_clf = False
        except Exception:
            # Try sklearn joblib
            try:
                import joblib
                model = joblib.load(str(p))
                # assume classifier if has predict_proba
                is_clf = hasattr(model, 'predict_proba')
            except Exception as e:
                print(json.dumps({"error": f"Failed to load model: {e}"}))
                sys.exit(2)

    # Expect either single dict of features or list of dicts
    if isinstance(data, dict):
        rows = [data]
    elif isinstance(data, list):
        rows = data
    else:
        print(json.dumps({"error": "Input must be JSON object or array of objects"}))
        sys.exit(2)

    try:
        df = pd.DataFrame(rows)
    except Exception as e:
        print(json.dumps({"error": f"Failed to construct DataFrame: {e}"}))
        sys.exit(2)

    # Basic preprocessing: ensure columns are in the same order model expects
    # We cannot reliably know expected columns; assume model handles it
    try:
        if is_clf and hasattr(model, 'predict_proba'):
            probs = model.predict_proba(df)
            out = [float(p[1]) if len(p)>1 else float(p[0]) for p in probs]
            # If single input, return scalar
            result = out[0] if len(out)==1 else out
        else:
            preds = model.predict(df)
            out = [float(p) for p in preds]
            result = out[0] if len(out)==1 else out
        print(json.dumps({"predictions": result}))
    except Exception as e:
        print(json.dumps({"error": f"Prediction failed: {e}"}))
        sys.exit(2)

if __name__ == '__main__':
    main()
