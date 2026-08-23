codeunit 88818 "CG-AL-X065 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding its own rows. Out-of-category lines are seeded with a
    // nonzero sentinel total so "untouched" and "zeroed" stay
    // distinguishable.

    local procedure Seed(EntryNo: Integer; Category: Code[10]; Qty: Integer; InitialTotal: Integer)
    var
        Line: Record "CG X065 Order Line";
    begin
        Line.Init();
        Line."Entry No." := EntryNo;
        Line.Category := Category;
        Line.Quantity := Qty;
        Line."Line Total" := InitialTotal;
        Line.Insert();
    end;

    local procedure TotalOf(EntryNo: Integer): Integer
    var
        Line: Record "CG X065 Order Line";
    begin
        Line.Get(EntryNo);
        exit(Line."Line Total");
    end;

    [Test]
    procedure EveryLineInTheCategoryIsRepriced()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(1, 'ALPHA', 2, 0);
        Seed(2, 'ALPHA', 3, 0);
        Seed(3, 'ALPHA', 4, 0);
        Seed(4, 'BETA', 6, 999);

        Repricer.RepriceCategory('ALPHA');

        Assert.AreEqual(20, TotalOf(1), 'Line 1 must be repriced');
        Assert.AreEqual(30, TotalOf(2), 'Line 2 must be repriced');
        Assert.AreEqual(40, TotalOf(3), 'Line 3 must be repriced');
        Assert.AreEqual(999, TotalOf(4), 'Line 4 is in another category and must not change');
    end;

    [Test]
    procedure VolumeDiscountAppliesAtTwentyUnits()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(10, 'ALPHA', 12, 0);
        Seed(11, 'ALPHA', 8, 0);
        Seed(12, 'BETA', 30, 999);

        Repricer.RepriceCategory('ALPHA');

        Assert.AreEqual(96, TotalOf(10), 'Line 10 must use the discounted price');
        Assert.AreEqual(64, TotalOf(11), 'Line 11 must use the discounted price');
        Assert.AreEqual(999, TotalOf(12), 'Line 12 is in another category and must not change');
    end;

    [Test]
    procedure BelowThresholdKeepsBasePrice()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(20, 'BETA', 19, 0);

        Repricer.RepriceCategory('BETA');

        Assert.AreEqual(133, TotalOf(20), 'A 19-unit category keeps its base price');
    end;

    [Test]
    procedure OtherCategoriesVolumeDoesNotChangeThePrice()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(40, 'GAMMA', 3, 0);
        Seed(41, 'BETA', 30, 999);

        Repricer.RepriceCategory('GAMMA');

        Assert.AreEqual(15, TotalOf(40), 'A 3-unit category keeps its base price whatever other categories hold');
        Assert.AreEqual(999, TotalOf(41), 'Line 41 is in another category and must not change');
    end;

    [Test]
    procedure RepricingIsRepeatable()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(30, 'ALPHA', 5, 0);
        Seed(31, 'ALPHA', 6, 0);

        Repricer.RepriceCategory('ALPHA');
        Repricer.RepriceCategory('ALPHA');

        Assert.AreEqual(50, TotalOf(30), 'Line 30 must be stable across repeated repricing');
        Assert.AreEqual(60, TotalOf(31), 'Line 31 must be stable across repeated repricing');
    end;

    [Test]
    procedure PriceServiceContractSurvives()
    var
        Line: Record "CG X065 Order Line";
        PriceSvc: Codeunit "CG X065 Price Svc";
    begin
        Line.DeleteAll();
        Seed(50, 'ALPHA', 4, 0);
        Line.Get(50);

        Assert.AreEqual(10, PriceSvc.UnitPriceFor(Line), 'A 4-unit ALPHA line prices at 10');
    end;
}
