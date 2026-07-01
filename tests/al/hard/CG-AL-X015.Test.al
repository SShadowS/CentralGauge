codeunit 80304 "CG-AL-X015 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure NavigatesExactlySelectedPlusCurrentRecord()
    var
        Item: Record "CG X015 Item";
        Navigator: Codeunit "CG X015 Navigator";
        ItemListPage: TestPage "CG X015 Item List";
        SelectedCodes: List of [Code[20]];
        VisitedCodes: List of [Code[20]];
        ExpectedCodes: List of [Code[20]];
    begin
        // Self-heal: a prior candidate's failure (the expected outcome for a
        // naive/wrong solution) must not leave state that collides with this run.
        Item.Reset();
        if Item.FindSet() then
            repeat
                Item.Delete();
            until Item.Next() = 0;

        InsertItem('A', 'Alpha');
        InsertItem('B', 'Bravo');
        InsertItem('C', 'Charlie');
        InsertItem('D', 'Delta');
        InsertItem('E', 'Echo');
        InsertItem('F', 'Foxtrot');

        // The user has picked B, D and F elsewhere (e.g. across multiple
        // unrelated filtered views) - a non-contiguous set that cannot be
        // reached by simply reusing an existing field on the record.
        SelectedCodes.Add('B');
        SelectedCodes.Add('D');
        SelectedCodes.Add('F');

        // The record currently in focus is C - deliberately NOT one of the
        // picked records.
        Item.Get('C');

        ItemListPage.Trap();
        Navigator.OpenSelectedItems(Item, SelectedCodes);

        ItemListPage.First();
        repeat
            // The BC test-page navigation surface can emit one trailing
            // blank/detached row past the true end of a filtered dataset;
            // guard against it rather than counting a phantom record.
            if ItemListPage."Code".Value <> '' then
                VisitedCodes.Add(ItemListPage."Code".Value);
        until not ItemListPage.Next();
        ItemListPage.Close();

        // Expected navigable set: the picked records plus the record that was
        // in focus when the picking happened, in key order - nothing else.
        ExpectedCodes.Add('B');
        ExpectedCodes.Add('C');
        ExpectedCodes.Add('D');
        ExpectedCodes.Add('F');

        Assert.AreEqual(
            JoinCodes(ExpectedCodes), JoinCodes(VisitedCodes),
            'The opened list must navigate across exactly the picked records plus the record in focus - nothing more, nothing less.');
    end;

    [Test]
    procedure ExcludesRecordsOutsideTheSelection()
    var
        Item: Record "CG X015 Item";
        Navigator: Codeunit "CG X015 Navigator";
        ItemListPage: TestPage "CG X015 Item List";
        SelectedCodes: List of [Code[20]];
        VisitedCode: Code[20];
    begin
        Item.Reset();
        if Item.FindSet() then
            repeat
                Item.Delete();
            until Item.Next() = 0;

        InsertItem('A', 'Alpha');
        InsertItem('B', 'Bravo');
        InsertItem('C', 'Charlie');

        SelectedCodes.Add('B');

        Item.Get('B');

        ItemListPage.Trap();
        Navigator.OpenSelectedItems(Item, SelectedCodes);

        ItemListPage.First();
        repeat
            VisitedCode := ItemListPage."Code".Value;
            if VisitedCode <> '' then
                Assert.AreNotEqual('A', VisitedCode,
                    'Record A must not be reachable - it was never selected and was not the focused record.');
        until not ItemListPage.Next();
        ItemListPage.Close();
    end;

    local procedure JoinCodes(Codes: List of [Code[20]]): Text
    var
        C: Code[20];
        Result: Text;
    begin
        foreach C in Codes do begin
            if Result <> '' then
                Result += '|';
            Result += C;
        end;
        exit(Result);
    end;

    local procedure InsertItem(ItemCode: Code[20]; ItemDescription: Text[50])
    var
        Item: Record "CG X015 Item";
    begin
        Item.Init();
        Item."Code" := ItemCode;
        Item."Description" := CopyStr(ItemDescription, 1, MaxStrLen(Item."Description"));
        Item.Insert(true);
    end;
}
