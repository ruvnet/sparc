import dotenv
from pathlib import Path
from setuptools import setup, find_packages

# load .env
dotenv.load_dotenv()

# Read the contents of README.md
this_directory = Path(__file__).parent
long_description = (this_directory / "README.md").read_text()

setup(
    name='sparc',
    version='0.87.6',  # Updated for improved math evaluation
    packages=find_packages(),
    install_requires=[
        'twine',
        'setuptools',
        'wheel',
        'flake8',
        'black',
        'pytest',
        'pip-upgrader',
        'httpx',
        'beautifulsoup4',
        'pypandoc',
        'playwright',
        'langchain-core',
        'numpy',
        'sympy',  # Required for symbolic math
        'langchain',
    ],
    author='rUv',
    author_email='ruv@ruv.net',
    description='SPARC CLI is a powerful command-line interface that implements the SPARC Framework methodology for AI-assisted software development. Combining autonomous research capabilities with guided implementation, it provides a comprehensive toolkit for analyzing codebases, planning changes, and executing development tasks with advanced AI assistance.',
    long_description=long_description,
    long_description_content_type='text/markdown',
    url='https://github.com/ruvnet/sparc',
    license='Apache License 2.0',
    classifiers=[
        'Development Status :: 3 - Alpha',
        'Intended Audience :: Developers',
        'Topic :: Software Development :: Libraries :: Application Frameworks',
        'License :: OSI Approved :: Apache Software License',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.7',
        'Programming Language :: Python :: 3.8',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
    ],
    entry_points={
        'console_scripts': [
            'sparc=sparc_cli.__main__:main',
        ],
    },
)
