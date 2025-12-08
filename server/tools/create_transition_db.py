import json
import chromadb

def create_transition_db():
    client = chromadb.PersistentClient(path="./transition_db")
    collection = client.get_or_create_collection(name="premiere_transitions")

    with open('transitionlist.json', 'r') as f:
        transition_data = json.load(f)

    ids = []
    documents = []
    metadatas = []

    for name, description in transition_data.items():
        ids.append(name)
        
        text_content = f"{name}: {description}"
        documents.append(text_content)
        
        metadatas.append({"transition_name": name, "raw_description": description})

    print(f"Adding {len(ids)} transitions to the database...")
    collection.add(
        documents=documents,
        metadatas=metadatas,
        ids=ids
    )
    print("Transition DB created successfully.")
    
    return collection