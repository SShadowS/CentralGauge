codeunit 80102 "CG-AL-M044 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestNextPriority_EmptyView_ReturnsOne()
    var
        PriorityCalc: Codeunit "CG M044 Priority Calc";
    begin
        // [SCENARIO] IsEmptyView=true must return literal '1' regardless of other inputs
        Assert.AreEqual('1', PriorityCalc.NextPriority(true, false, '', ''),
            'Empty view with BelowxRec=false must return literal 1');
        Assert.AreEqual('1', PriorityCalc.NextPriority(true, true, '', ''),
            'Empty view with BelowxRec=true must return literal 1');
        Assert.AreEqual('1', PriorityCalc.NextPriority(true, true, '99', '50'),
            'Empty view must ignore xRec/last-in-group inputs and return 1');
    end;

    [Test]
    procedure TestNextPriority_BelowxRec_UsesXRec()
    var
        PriorityCalc: Codeunit "CG M044 Priority Calc";
    begin
        // [SCENARIO] BelowxRec=true on a non-empty view must derive from xRecPriority
        Assert.AreEqual('2', PriorityCalc.NextPriority(false, true, '1', ''),
            'BelowxRec=true must return IncStr of xRecPriority');
        Assert.AreEqual('11', PriorityCalc.NextPriority(false, true, '10', '99'),
            'BelowxRec=true must ignore LastInGroupPriority and use xRecPriority');
        Assert.AreEqual('A2', PriorityCalc.NextPriority(false, true, 'A1', ''),
            'BelowxRec=true must apply IncStr semantics to alphanumeric prefixes');
    end;

    [Test]
    procedure TestNextPriority_NotBelow_UsesFindLast()
    var
        PriorityCalc: Codeunit "CG M044 Priority Calc";
    begin
        // [SCENARIO] BelowxRec=false on a non-empty view must derive from LastInGroupPriority
        Assert.AreEqual('6', PriorityCalc.NextPriority(false, false, '', '5'),
            'BelowxRec=false must return IncStr of LastInGroupPriority');
        Assert.AreEqual('100', PriorityCalc.NextPriority(false, false, '999', '99'),
            'BelowxRec=false must ignore xRecPriority and use LastInGroupPriority');
    end;

    [Test]
    procedure TestPage_EmptyFilteredView_AssignsOne()
    var
        Group: Record "CG M044 Group";
        Item: Record "CG M044 Item";
        ItemList: TestPage "CG M044 Item List";
        GroupCode: Code[20];
    begin
        // [SCENARIO] Inserting via the page on an empty filtered view yields Priority='1'
        GroupCode := 'EMPTY-A';
        EnsureGroup(Group, GroupCode);
        ClearGroupItems(GroupCode);

        ItemList.OpenEdit();
        ItemList.FILTER.SetFilter("Group Code", GroupCode);
        ItemList.New();
        ItemList."Group Code".SetValue(GroupCode);
        ItemList.Description.SetValue('first');
        ItemList.Close();

        Item.SetRange("Group Code", GroupCode);
        Assert.AreEqual(1, Item.Count(), 'Exactly one item should exist in the empty group after insert');
        Item.FindFirst();
        Assert.AreEqual('1', Item."Priority", 'Priority on the first row of an empty filtered view must be 1');

        ClearGroupItems(GroupCode);
        Group.Delete();
    end;

    [Test]
    procedure TestPage_BelowExistingRow_IncrementsXRec()
    var
        Group: Record "CG M044 Group";
        Item: Record "CG M044 Item";
        ItemList: TestPage "CG M044 Item List";
        GroupCode: Code[20];
        Anchor: Record "CG M044 Item";
    begin
        // [SCENARIO] Inserting via the page while positioned on an existing row yields IncStr of that row's Priority
        GroupCode := 'POP-B';
        EnsureGroup(Group, GroupCode);
        ClearGroupItems(GroupCode);

        SeedItem(Anchor, GroupCode, '7', 'anchor');

        ItemList.OpenEdit();
        ItemList.FILTER.SetFilter("Group Code", GroupCode);
        ItemList.GoToRecord(Anchor);
        ItemList.New();
        ItemList."Group Code".SetValue(GroupCode);
        ItemList.Description.SetValue('after-anchor');
        ItemList.Close();

        Item.SetRange("Group Code", GroupCode);
        Item.SetRange(Description, 'after-anchor');
        Item.FindFirst();
        Assert.AreEqual('8', Item."Priority",
            'Priority on row inserted while positioned on the anchor must equal IncStr of the anchor');

        ClearGroupItems(GroupCode);
        Group.Delete();
    end;

    [Test]
    procedure TestPage_DistinguishesEmptyVsPopulated()
    var
        GroupA: Record "CG M044 Group";
        GroupB: Record "CG M044 Group";
        Item: Record "CG M044 Item";
        ItemList: TestPage "CG M044 Item List";
        AnchorB: Record "CG M044 Item";
    begin
        // [SCENARIO] Empty group A produces '1' while populated group B produces IncStr of the anchor
        EnsureGroup(GroupA, 'GRP-EMPTY');
        EnsureGroup(GroupB, 'GRP-POP');
        ClearGroupItems('GRP-EMPTY');
        ClearGroupItems('GRP-POP');

        SeedItem(AnchorB, 'GRP-POP', '4', 'anchor-b');

        ItemList.OpenEdit();
        ItemList.FILTER.SetFilter("Group Code", 'GRP-EMPTY');
        ItemList.New();
        ItemList."Group Code".SetValue('GRP-EMPTY');
        ItemList.Description.SetValue('empty-row');
        ItemList.Close();

        ItemList.OpenEdit();
        ItemList.FILTER.SetFilter("Group Code", 'GRP-POP');
        ItemList.GoToRecord(AnchorB);
        ItemList.New();
        ItemList."Group Code".SetValue('GRP-POP');
        ItemList.Description.SetValue('pop-row');
        ItemList.Close();

        Item.SetRange("Group Code", 'GRP-EMPTY');
        Item.SetRange(Description, 'empty-row');
        Item.FindFirst();
        Assert.AreEqual('1', Item."Priority", 'Empty-group insert must produce 1');

        Item.Reset();
        Item.SetRange("Group Code", 'GRP-POP');
        Item.SetRange(Description, 'pop-row');
        Item.FindFirst();
        Assert.AreEqual('5', Item."Priority", 'Populated-group insert must produce IncStr of anchor');

        ClearGroupItems('GRP-EMPTY');
        ClearGroupItems('GRP-POP');
        GroupA.Delete();
        GroupB.Delete();
    end;

    local procedure EnsureGroup(var Group: Record "CG M044 Group"; GroupCode: Code[20])
    begin
        if Group.Get(GroupCode) then
            exit;
        Group.Init();
        Group.Code := GroupCode;
        Group.Description := GroupCode;
        Group.Insert();
    end;

    local procedure ClearGroupItems(GroupCode: Code[20])
    var
        Item: Record "CG M044 Item";
    begin
        Item.SetRange("Group Code", GroupCode);
        if not Item.IsEmpty() then
            Item.DeleteAll();
    end;

    local procedure SeedItem(var Item: Record "CG M044 Item"; GroupCode: Code[20]; PriorityValue: Code[20]; Descr: Text[100])
    begin
        Item.Init();
        Item."Group Code" := GroupCode;
        Item."Priority" := PriorityValue;
        Item.Description := Descr;
        Item.Insert();
    end;
}
