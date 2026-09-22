from keys import sync


def test_push_then_pull_round_trip(tmp_path, fake_s3):
    s3 = fake_s3
    src = tmp_path / "src"
    (src / "a").mkdir(parents=True)
    (src / "a" / "one.txt").write_text("1")
    (src / "two.txt").write_text("2")
    keys = sync.push(src, "bucket", "processed/", s3=s3)
    assert keys == ["processed/a/one.txt", "processed/two.txt"]
    dest = tmp_path / "dest"
    files = sync.pull("bucket", "processed/", dest, s3=s3)
    assert sorted(f.relative_to(dest).as_posix() for f in files) == ["a/one.txt", "two.txt"]
    assert (dest / "a" / "one.txt").read_text() == "1"


def test_push_file_uses_exact_key(tmp_path, fake_s3):
    s3 = fake_s3
    f = tmp_path / "fold0.pt"
    f.write_bytes(b"weights")
    assert sync.push_file(f, "bucket", "models/run1/fold0/model.pt", s3=s3) == "models/run1/fold0/model.pt"
    assert s3.store[("bucket", "models/run1/fold0/model.pt")] == b"weights"


def test_pull_ignores_the_prefix_placeholder(tmp_path, fake_s3):
    s3 = fake_s3
    s3.store[("bucket", "raw/")] = b""
    s3.store[("bucket", "raw/input.csv")] = b"x"
    files = sync.pull("bucket", "raw/", tmp_path, s3=s3)
    assert [f.name for f in files] == ["input.csv"]
