codeunit 80272 "CG-AL-H057 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestPageDoesNotWriteToSource()
    var
        SamplePage: TestPage "CG H057 List";
        S: Record "CG H057 Sample";
    begin
        // Pre: every seeded row has Touch Count = 0
        S.FindSet();
        repeat
            Assert.AreEqual(0, S."Touch Count", 'Pre-cond: seeded rows untouched.');
        until S.Next() = 0;

        // Open the page, iterate every visible row (firing OnAfterGetRecord
        // for each), close.
        SamplePage.OpenView();
        SamplePage.First();
        while SamplePage.Next() do;
        SamplePage.Close();

        // Post: Touch Count MUST still be 0 for every row. If the model
        // wrote Rec.Modify inside OnAfterGetRecord, the table's OnModify
        // trigger would have bumped Touch Count.
        S.Reset();
        S.FindSet();
        repeat
            Assert.AreEqual(0, S."Touch Count",
                'Touch Count must still be 0 - the page must not write to the source table.');
        until S.Next() = 0;
    end;

    [Test]
    procedure TestStatusTagShort()
    var
        SamplePage: TestPage "CG H057 List";
    begin
        SamplePage.OpenView();
        SamplePage.FILTER.SetFilter("Code", 'A');
        SamplePage.First();
        Assert.AreEqual('SHORT', Format(SamplePage."Status Tag"),
            'Row A has short description and must render Status Tag = SHORT.');
        SamplePage.Close();
    end;

    [Test]
    procedure TestStatusTagMedium()
    var
        SamplePage: TestPage "CG H057 List";
    begin
        SamplePage.OpenView();
        SamplePage.FILTER.SetFilter("Code", 'B');
        SamplePage.First();
        Assert.AreEqual('MEDIUM', Format(SamplePage."Status Tag"),
            'Row B has medium description and must render Status Tag = MEDIUM.');
        SamplePage.Close();
    end;

    [Test]
    procedure TestStatusTagLong()
    var
        SamplePage: TestPage "CG H057 List";
    begin
        SamplePage.OpenView();
        SamplePage.FILTER.SetFilter("Code", 'C');
        SamplePage.First();
        Assert.AreEqual('LONG', Format(SamplePage."Status Tag"),
            'Row C has a long description and must render Status Tag = LONG.');
        SamplePage.Close();
    end;
}
