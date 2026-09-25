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


def test_push_file_passes_extra_args(tmp_path, fake_s3):
    f = tmp_path / "meta.json"
    f.write_text("{}")
    sync.push_file(f, "site", "data/meta.json", s3=fake_s3, extra={"CacheControl": "max-age=300"})
    assert fake_s3.extra[("site", "data/meta.json")] == {"CacheControl": "max-age=300"}
    sync.push_file(f, "site", "data/plain.json", s3=fake_s3)
    assert fake_s3.extra[("site", "data/plain.json")] is None


def test_push_directory_passes_extra_args(tmp_path, fake_s3):
    src = tmp_path / "site"
    (src / "games").mkdir(parents=True)
    (src / "games" / "1.json").write_text("{}")
    sync.push(src, "site", "data/", s3=fake_s3, extra={"ContentType": "application/json"})
    assert fake_s3.extra[("site", "data/games/1.json")] == {"ContentType": "application/json"}


def test_pull_file_downloads_one_object(tmp_path, fake_s3):
    fake_s3.store[("data", "raw/supplementary_data.csv")] = b"a,b\n1,2\n"
    dest = sync.pull_file("data", "raw/supplementary_data.csv", tmp_path / "raw" / "supplementary_data.csv", s3=fake_s3)
    assert dest == tmp_path / "raw" / "supplementary_data.csv" and dest.read_text() == "a,b\n1,2\n"
