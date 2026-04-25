import os
from flask import Flask
from allthethings.page.views import page

# Entry point — mirrors how Anna's Archive bootstraps its blueprints.
# In the real repo this wiring lives in create_app(); here it's kept minimal
# so the feature can be run standalone with:  flask run  or  python app.py

BASE_DIR = os.path.dirname(__file__)

app = Flask(
    __name__,
    # Point Flask at the Jinja templates inside the blueprint folder
    template_folder=os.path.join(BASE_DIR, "allthethings/page/templates"),
    # Point Flask at our static files (CSS, JS)
    static_folder=os.path.join(BASE_DIR, "allthethings/static"),
    static_url_path="/static",
)

app.register_blueprint(page)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
