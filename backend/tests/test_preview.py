import pytest
from app.services.preview.base import CodePreviewService

@pytest.fixture
def preview_service():
    return CodePreviewService()

def test_code_preview_python(preview_service):
    code = '''def hello():
    print("Hello, World!")'''
    
    result = preview_service.highlight_code(code, "python")
    
    assert "html" in result
    assert "css" in result
    assert result["language"].lower() == "python"
    assert "highlight" in result["css"]
    assert "print" in result["html"]

def test_code_preview_auto_detect(preview_service):
    code = '''function hello() {
    console.log("Hello, World!");
}'''
    
    result = preview_service.highlight_code(code)
    
    assert result["language"].lower() == "javascript"
    assert "console" in result["html"]

def test_code_preview_invalid_language(preview_service):
    code = 'print("Hello")'
    
    result = preview_service.highlight_code(code, "invalid_lang")
    
    assert "html" in result
    assert "print" in result["html"]

def test_code_preview_caching(preview_service):
    code = 'print("test")'
    
    result1 = preview_service.highlight_code(code, "python")
    result2 = preview_service.highlight_code(code, "python")
    
    assert result1 == result2
