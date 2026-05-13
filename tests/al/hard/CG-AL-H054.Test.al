codeunit 80269 "CG-AL-H054 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestEmptyInitially()
    var
        Cache: Codeunit "CG H054 Cache";
        V: Integer;
    begin
        Cache.Clear();
        Assert.AreEqual(0, Cache.Count(), 'Cache empty after Clear.');
        Assert.IsFalse(Cache.Get('K1', V), 'Get on empty cache returns false.');
    end;

    [Test]
    procedure TestAddBelowCapacity()
    var
        Cache: Codeunit "CG H054 Cache";
        V: Integer;
    begin
        Cache.Clear();
        Cache.Add('K1', 10);
        Cache.Add('K2', 20);
        Cache.Add('K3', 30);
        Assert.AreEqual(3, Cache.Count(), 'Three entries fit under the cap.');
        Assert.IsTrue(Cache.Get('K1', V), 'K1 present.');
        Assert.AreEqual(10, V, 'K1 value preserved.');
        Assert.IsTrue(Cache.Get('K3', V), 'K3 present.');
        Assert.AreEqual(30, V, 'K3 value preserved.');
    end;

    [Test]
    procedure TestFifoEvictionAtCapacity()
    var
        Cache: Codeunit "CG H054 Cache";
        V: Integer;
    begin
        Cache.Clear();
        Cache.Add('K1', 1);
        Cache.Add('K2', 2);
        Cache.Add('K3', 3);
        Cache.Add('K4', 4);
        Cache.Add('K5', 5);
        Cache.Add('K6', 6);
        Cache.Add('K7', 7);
        Assert.AreEqual(5, Cache.Count(), 'Cap is 5 even after 7 adds.');
        Assert.IsFalse(Cache.Get('K1', V), 'K1 evicted (oldest).');
        Assert.IsFalse(Cache.Get('K2', V), 'K2 evicted (second oldest).');
        Assert.IsTrue(Cache.Get('K3', V), 'K3 still present.');
        Assert.IsTrue(Cache.Get('K7', V), 'K7 present (most recent).');
        Assert.AreEqual(7, V, 'K7 value correct.');
    end;

    [Test]
    procedure TestUpdateExistingKeyDoesNotEvict()
    var
        Cache: Codeunit "CG H054 Cache";
        V: Integer;
    begin
        Cache.Clear();
        Cache.Add('K1', 1);
        Cache.Add('K2', 2);
        Cache.Add('K3', 3);
        Cache.Add('K4', 4);
        Cache.Add('K5', 5);
        // K1 is currently oldest. Re-Add K1 with new value MUST replace value
        // without evicting any entry. Count stays 5, all keys still present.
        Cache.Add('K1', 99);
        Assert.AreEqual(5, Cache.Count(), 'Updating existing key does not change count.');
        Assert.IsTrue(Cache.Get('K1', V), 'K1 still present after update.');
        Assert.AreEqual(99, V, 'K1 value updated.');
        Assert.IsTrue(Cache.Get('K2', V), 'K2 still present (not evicted by K1 update).');
    end;

    [Test]
    procedure TestClearEmptiesCache()
    var
        Cache: Codeunit "CG H054 Cache";
        V: Integer;
    begin
        Cache.Clear();
        Cache.Add('K1', 1);
        Cache.Add('K2', 2);
        Assert.AreEqual(2, Cache.Count(), 'Pre-condition: 2 entries.');
        Cache.Clear();
        Assert.AreEqual(0, Cache.Count(), 'Clear drops count to 0.');
        Assert.IsFalse(Cache.Get('K1', V), 'K1 gone after Clear.');
    end;
}
