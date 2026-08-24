codeunit 89301 "CG-AL-X107 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows.

    local procedure Reset()
    var
        DealHeader: Record "CG X107 Deal Header";
        PostedDeal: Record "CG X107 Posted Deal";
    begin
        DealHeader.DeleteAll();
        PostedDeal.DeleteAll();
    end;

    local procedure SeedDeal(No: Code[20]; DealReference: Text[30]; Amount: Decimal)
    var
        DealHeader: Record "CG X107 Deal Header";
    begin
        DealHeader.Init();
        DealHeader."No." := No;
        DealHeader."Deal Reference" := DealReference;
        DealHeader.Amount := Amount;
        DealHeader.Insert();
    end;

    [Test]
    procedure PostedDealCarriesTheDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        SeedDeal('D001', 'REF-ALPHA-0001-XXXXXXXXXXXXXX', 100);

        Poster.PostDeal('D001');

        PostedDeal.Get('D001');
        Assert.AreEqual('REF-ALPHA-0001-XXXXXXXXXXXXXX', PostedDeal."Deal Reference",
            'Expected the posted deal to carry the deal reference recorded at posting time');
    end;

    [Test]
    procedure PostedDealCarriesADifferentDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        SeedDeal('D002', 'REF-BETA-9999-YYYYYYYYYYYYYYY', 250);

        Poster.PostDeal('D002');

        PostedDeal.Get('D002');
        Assert.AreEqual('REF-BETA-9999-YYYYYYYYYYYYYYY', PostedDeal."Deal Reference",
            'Expected the posted deal to carry this deal header''s own reference');
    end;

    [Test]
    procedure PostingKeepsTheAmountThePosterAssigns()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        SeedDeal('D003', 'REF-GAMMA-1234-ZZZZZZZZZZZZZZ', 777.5);

        Poster.PostDeal('D003');

        PostedDeal.Get('D003');
        Assert.AreEqual(777.5, PostedDeal.Amount,
            'Expected the posted deal to keep the amount recorded when it was posted');
    end;

    [Test]
    procedure PostingOneDealDoesNotChangeAnotherAlreadyPostedDeal()
    var
        OtherPostedDeal: Record "CG X107 Posted Deal";
        NewPostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        OtherPostedDeal.Init();
        OtherPostedDeal."No." := 'EXIST';
        OtherPostedDeal."Deal Reference" := 'REF-EXISTING-SENTINEL-000000';
        OtherPostedDeal.Amount := 555;
        OtherPostedDeal.Insert();

        SeedDeal('D004', 'REF-DELTA-4444-WWWWWWWWWWWWWW', 42);
        Poster.PostDeal('D004');

        OtherPostedDeal.Get('EXIST');
        Assert.AreEqual('REF-EXISTING-SENTINEL-000000', OtherPostedDeal."Deal Reference",
            'Expected an already-posted deal to keep its own deal reference when another deal is posted');
        Assert.AreEqual(555, OtherPostedDeal.Amount,
            'Expected an already-posted deal to keep its own amount when another deal is posted');

        NewPostedDeal.Get('D004');
        Assert.AreEqual('REF-DELTA-4444-WWWWWWWWWWWWWW', NewPostedDeal."Deal Reference",
            'Expected the newly posted deal to carry its own deal reference');
    end;
}
