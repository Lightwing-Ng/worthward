import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import create_app

app = create_app()
with app.app_context(), app.test_client() as client:
    # Compare empty
    with open("compare.html", "wb") as f:
        f.write(client.get('/compare', headers={"X-Requested-With": "workspace-hydrate"}).data)
    # Compare with data
    with open("compare_full.html", "wb") as f:
        f.write(client.get('/compare?ticker=MSFT&ticker=AAPL', headers={"X-Requested-With": "workspace-hydrate"}).data)
    # Portfolio with data
    with open("portfolio_full.html", "wb") as f:
        f.write(client.get('/portfolio?ticker=MSFT&ticker=AAPL&weight=50&weight=50', headers={"X-Requested-With": "workspace-hydrate"}).data)
    # Portfolio empty
    with open("portfolio_empty.html", "wb") as f:
        f.write(client.get('/portfolio', headers={"X-Requested-With": "workspace-hydrate"}).data)
