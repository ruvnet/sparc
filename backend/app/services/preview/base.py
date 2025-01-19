from typing import Dict, Optional
import pygments
from pygments import lexers, formatters
from pygments.util import ClassNotFound
from pygments.lexers.special import TextLexer
from pygments.lexers.javascript import JavascriptLexer

class CodePreviewService:
    def __init__(self):
        self._cache = {}
        
    def highlight_code(self, code: str, language: Optional[str] = None) -> Dict:
        cache_key = f"{code}-{language}"
        if cache_key in self._cache:
            return self._cache[cache_key]
            
        if language:
            try:
                lexer = lexers.get_lexer_by_name(language)
            except ClassNotFound:
                lexer = lexers.guess_lexer(code)
        else:
            # Try to detect if the code is JavaScript
            if "function" in code and ("{" in code or "(" in code) and ";" in code:
                lexer = JavascriptLexer()
            else:
                try:
                    lexer = lexers.guess_lexer(code)
                except ClassNotFound:
                    lexer = TextLexer()
            
        formatter = formatters.HtmlFormatter(
            linenos=True,
            cssclass="highlight",
            style="monokai"
        )
        
        result = {
            "html": pygments.highlight(code, lexer, formatter),
            "css": formatter.get_style_defs(".highlight"),
            "language": lexer.name
        }
        
        self._cache[cache_key] = result
        return result
