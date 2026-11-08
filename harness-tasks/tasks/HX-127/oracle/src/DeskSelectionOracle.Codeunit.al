codeunit 87865 "HX127 Desk Selection Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RentalScopeKept()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        RentalHX127Selection(Selection, 'HX127N', '');
        Assert.AreEqual(2, Selection.Count(), 'Precondition: the selection on screen has 2 contracts');

        Store.SaveSelection('HX127-A1', Selection);
        Store.OpenSelection('HX127-A1', Opened);

        Assert.AreEqual(Database::"CGR Rental Contract", Opened.Number(), 'The opened selection is on the same table');
        Assert.AreEqual(2, Opened.Count(), 'The opened selection keeps the desk scope and the user filters');
    end;

    [Test]
    procedure RentalUserFiltersCleared()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        RentalHX127Selection(Selection, 'HX127N', 'HX127N|HX127S');

        Store.SaveSelection('HX127-A2', Selection);
        Store.OpenSelection('HX127-A2', Opened);
        Opened.FilterGroup(0);
        Opened.Field(11).SetRange();
        Opened.Field(6).SetRange();

        Assert.AreEqual(3, Opened.Count(), 'With the user filters cleared, the desk scope still limits the selection to its branch');
    end;

    [Test]
    procedure RentalUserFilterReads()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        RentalHX127Selection(Selection, 'HX127N', 'HX127N|HX127S');

        Store.SaveSelection('HX127-A3', Selection);
        Store.OpenSelection('HX127-A3', Opened);
        Opened.FilterGroup(0);

        Assert.AreEqual('HX127N|HX127S', Opened.Field(11).GetFilter(), 'The user Branch Code filter reads as the user set it');
        Assert.AreEqual('Open', Opened.Field(6).GetFilter(), 'The user Status filter reads as the user set it');
    end;

    [Test]
    procedure RentalOrderKept()
    var
        Contract: Record "CGR Rental Contract";
        DeskScope: Codeunit "CGR Rental Desk Scope";
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        DeskScope.ScopeToBranch(Contract, 'HX127N');
        Contract.SetRange("No.", 'HX127-R1', 'HX127-R6');
        Selection.GetTable(Contract);
        Selection.CurrentKeyIndex(2);
        Selection.Ascending(false);
        Selection.FindFirst();
        Assert.AreEqual('HX127-R2', Format(Selection.Field(1).Value()), 'Precondition: the selection on screen starts with HX127-R2');

        Store.SaveSelection('HX127-A4', Selection);
        Store.OpenSelection('HX127-A4', Opened);

        Assert.AreEqual(2, Opened.CurrentKeyIndex(), 'The opened selection keeps the key');
        Assert.IsTrue(Opened.FindFirst(), 'The opened selection has records');
        Assert.AreEqual('HX127-R2', Format(Opened.Field(1).Value()), 'The opened selection keeps the order');
    end;

    [Test]
    procedure LeaseScopeKept()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Leases();
        LeaseHX127Selection(Selection);
        Assert.AreEqual(3, Selection.Count(), 'Precondition: the lease selection on screen has 3 leases');

        Store.SaveSelection('HX127-A5', Selection);
        Store.OpenSelection('HX127-A5', Opened);

        Assert.AreEqual(Database::"CGR Lease Contract", Opened.Number(), 'The opened selection is on the same table');
        Assert.AreEqual(3, Opened.Count(), 'The opened lease selection keeps the start-period scope and the user filter');
    end;

    [Test]
    procedure CreatedLaterIsIn()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        RentalHX127Selection(Selection, 'HX127N', '');

        Store.SaveSelection('HX127-A6', Selection);
        AddHX127Contract('HX127-R7', 'HX127N', "CGR Rental Status"::Open, '');
        Store.OpenSelection('HX127-A6', Opened);

        Assert.AreEqual(3, Opened.Count(), 'A contract created after saving that matches the selection is in it');
    end;

    [Test]
    procedure SaveTwiceReplaces()
    var
        Store: Codeunit "CGR Desk Selection Store";
        LeaseSelection: RecordRef;
        RentalSelection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        SeedHX127Leases();
        LeaseHX127Selection(LeaseSelection);
        RentalHX127Selection(RentalSelection, 'HX127N', '');

        Store.SaveSelection('HX127-B', LeaseSelection);
        Store.SaveSelection('HX127-B', RentalSelection);
        Store.OpenSelection('HX127-B', Opened);

        Assert.AreEqual(Database::"CGR Rental Contract", Opened.Number(), 'Saving again under the code replaces the saved selection');
        Assert.AreEqual(2, Opened.Count(), 'The replacing selection is the one opened');
    end;

    [Test]
    procedure UnknownCode()
    var
        Runner: Codeunit "HX127 Open Runner";
        Ok: Boolean;
    begin
        InitHX127();
        Commit();

        Runner.SetHX127Code('HX127-NONE');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Opening a code that was never saved stops with an error');
        Assert.AreEqual('There is no saved selection HX127-NONE.', GetLastErrorText(), 'The error names the code');
    end;

    [Test]
    procedure PartnerScope()
    var
        PartnerOrder: Record "HX127 Partner Order";
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        AddHX127PartnerOrder('HX127-P1', 'EAST', 50);
        AddHX127PartnerOrder('HX127-P2', 'EAST', 150);
        AddHX127PartnerOrder('HX127-P3', 'WEST', 300);
        AddHX127PartnerOrder('HX127-P4', 'EAST', 200);
        PartnerOrder.FilterGroup(2);
        PartnerOrder.SetRange("Region Code", 'EAST');
        PartnerOrder.FilterGroup(0);
        PartnerOrder.SetFilter(Amount, '>100');
        Selection.GetTable(PartnerOrder);
        Assert.AreEqual(2, Selection.Count(), 'Precondition: the partner selection on screen has 2 orders');

        Store.SaveSelection('HX127-A9', Selection);
        Store.OpenSelection('HX127-A9', Opened);

        Assert.AreEqual(Database::"HX127 Partner Order", Opened.Number(), 'The opened selection is on the partner table');
        Assert.AreEqual(2, Opened.Count(), 'The partner scope and the user filter are kept');
    end;

    [Test]
    procedure BothFamiliesOneInstance()
    var
        Store: Codeunit "CGR Desk Selection Store";
        RentalSelection: RecordRef;
        LeaseSelection: RecordRef;
        OpenedLease: RecordRef;
        OpenedRental: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        SeedHX127Leases();
        RentalHX127Selection(RentalSelection, 'HX127N', '');
        LeaseHX127Selection(LeaseSelection);

        Store.SaveSelection('HX127-C1', RentalSelection);
        Store.SaveSelection('HX127-C2', LeaseSelection);
        Store.OpenSelection('HX127-C2', OpenedLease);
        Store.OpenSelection('HX127-C1', OpenedRental);

        Assert.AreEqual(Database::"CGR Lease Contract", OpenedLease.Number(), 'C2 opens on the lease table');
        Assert.AreEqual(3, OpenedLease.Count(), 'C2 keeps the lease scope and filter');
        Assert.AreEqual(Database::"CGR Rental Contract", OpenedRental.Number(), 'C1 opens on the rental table');
        Assert.AreEqual(2, OpenedRental.Count(), 'C1 keeps the rental scope and filter');
    end;

    [Test]
    procedure EmptyScope()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Selection: RecordRef;
        Opened: RecordRef;
    begin
        InitHX127();
        SeedHX127Contracts();
        RentalHX127Selection(Selection, 'HX127NONE', '');

        Store.SaveSelection('HX127-A11', Selection);
        Store.OpenSelection('HX127-A11', Opened);

        Assert.AreEqual(0, Opened.Count(), 'A selection whose scope matches nothing opens empty');
    end;

    local procedure InitHX127()
    var
        Contract: Record "CGR Rental Contract";
        Lease: Record "CGR Lease Contract";
        PartnerOrder: Record "HX127 Partner Order";
    begin
        WorkDate(20270310D);
        Contract.SetFilter("No.", 'HX127-*');
        Contract.DeleteAll();
        Lease.SetFilter("No.", 'HX127-*');
        Lease.DeleteAll();
        PartnerOrder.DeleteAll();
    end;

    local procedure SeedHX127Contracts()
    begin
        AddHX127Contract('HX127-R1', 'HX127N', "CGR Rental Status"::Open, 'HX127-VA');
        AddHX127Contract('HX127-R2', 'HX127N', "CGR Rental Status"::Open, 'HX127-VC');
        AddHX127Contract('HX127-R3', 'HX127N', "CGR Rental Status"::"Checked Out", 'HX127-VB');
        AddHX127Contract('HX127-R4', 'HX127S', "CGR Rental Status"::Open, 'HX127-VZ');
        AddHX127Contract('HX127-R5', 'HX127S', "CGR Rental Status"::"Checked Out", '');
        AddHX127Contract('HX127-R6', 'HX127W', "CGR Rental Status"::Open, '');
    end;

    local procedure SeedHX127Leases()
    begin
        AddHX127Lease('HX127-L1', 20270115D, 150);
        AddHX127Lease('HX127-L2', 20270310D, 200);
        AddHX127Lease('HX127-L3', 20270505D, 250);
        AddHX127Lease('HX127-L4', 20270720D, 300);
        AddHX127Lease('HX127-L5', 20271101D, 50);
    end;

    local procedure AddHX127Contract(No: Code[20]; BranchCode: Code[10]; Status: Enum "CGR Rental Status"; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Init();
        Contract."No." := No;
        Contract."Branch Code" := BranchCode;
        Contract.Status := Status;
        Contract."Vehicle No." := VehicleNo;
        Contract."Start Date" := 20270301D;
        Contract.Insert();
    end;

    local procedure AddHX127Lease(No: Code[20]; StartDate: Date; BaseRate: Decimal)
    var
        Lease: Record "CGR Lease Contract";
    begin
        Lease.Init();
        Lease."No." := No;
        Lease."Start Date" := StartDate;
        Lease.Months := 12;
        Lease."Base Rate" := BaseRate;
        Lease.Insert();
    end;

    local procedure AddHX127PartnerOrder(No: Code[20]; RegionCode: Code[10]; Amount: Decimal)
    var
        PartnerOrder: Record "HX127 Partner Order";
    begin
        PartnerOrder.Init();
        PartnerOrder."Order No." := No;
        PartnerOrder."Region Code" := RegionCode;
        PartnerOrder.Amount := Amount;
        PartnerOrder.Insert();
    end;

    local procedure RentalHX127Selection(var Selection: RecordRef; ScopeBranch: Code[10]; UserBranchFilter: Text)
    var
        Contract: Record "CGR Rental Contract";
        DeskScope: Codeunit "CGR Rental Desk Scope";
    begin
        DeskScope.ScopeToBranch(Contract, ScopeBranch);
        if UserBranchFilter <> '' then
            Contract.SetFilter("Branch Code", UserBranchFilter);
        Contract.SetRange(Status, Contract.Status::Open);
        Selection.GetTable(Contract);
    end;

    local procedure LeaseHX127Selection(var Selection: RecordRef)
    var
        Lease: Record "CGR Lease Contract";
        DeskScope: Codeunit "CGR Lease Desk Scope";
    begin
        DeskScope.ScopeToStartPeriod(Lease, 20270101D, 20270630D);
        Lease.SetFilter("Base Rate", '>100');
        Selection.GetTable(Lease);
    end;
}
