codeunit 80293 "CG-AL-X004 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Seed(CountA: Integer)
    var
        Item: Record "CG X004 Item";
        i: Integer;
    begin
        Item.DeleteAll();
        for i := 1 to CountA do begin
            Item.Init();
            Item."Entry No." := i;
            Item.Category := 'A';
            Item.Tag := i;
            Item.Insert();
        end;
        Commit();
    end;

    local procedure CountByCategory(Category: Code[1]): Integer
    var
        Item: Record "CG X004 Item";
    begin
        Item.SetRange(Category, Category);
        exit(Item.Count());
    end;

    [Test]
    procedure CopiesEachAtoExactlyOneB()
    var
        Copier: Codeunit "CG X004 Copier";
        Created: Integer;
    begin
        // [GIVEN] Four category-A items
        Seed(4);

        // [WHEN] The copy runs
        Created := Copier.CopyAToB();

        // [THEN] Exactly four category-B items now exist
        Assert.AreEqual(4, Created, 'CopyAToB reports four created');
        Assert.AreEqual(4, CountByCategory('B'), 'Exactly four B rows exist');
        Assert.AreEqual(4, CountByCategory('A'), 'A rows are untouched');
    end;

    [Test]
    procedure ReRunIsIdempotent()
    var
        Copier: Codeunit "CG X004 Copier";
    begin
        // [GIVEN] Four A items, already copied once
        Seed(4);
        Copier.CopyAToB();

        // [WHEN] The copy runs a second time
        Assert.AreEqual(0, Copier.CopyAToB(), 'Second run creates nothing new');

        // [THEN] Still exactly four B rows (no duplicates, no error)
        Assert.AreEqual(4, CountByCategory('B'), 'Still four B rows after re-run');
    end;
}
