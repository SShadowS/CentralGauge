codeunit 87420 "HX098 Boat Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        // A boat is rented per day like any other asset.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B01', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-B01', 'HX98-HB', 'BL-0101');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1010, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(600, Pricing.CalcAmount(Contract), 'S1: three days at the boat''s daily rate, hours within the allowance');

        HX098Asset('HX98-B1W', "CGR Asset Type"::Boat, 2000, 150);
        ContractNo := HX098Contract('HX98-B1W', 'HX98-HB', 'BL-0111');
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 2010, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(300, Pricing.CalcAmount(Contract), 'S1: the weekend package prices a boat like a car');

        HX098WeekendSurcharge(50);
        HX098Asset('HX98-B1S', "CGR Asset Type"::Boat, 3000, 100);
        ContractNo := HX098Contract('HX98-B1S', 'HX98-HB', 'BL-0112');
        Contract.Get(ContractNo);
        Contract."Start Date" := 20270305D;
        Contract."End Date" := 20270307D;
        Contract.Modify();
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 3010, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(400, Pricing.CalcAmount(Contract), 'S1: Friday to Sunday, 300 plus the weekend surcharge on two days');
    end;

    [Test]
    procedure Scenario02()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Pricing: Codeunit "CGR Rental Pricing";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        // Engine hours over the daily allowance are charged at the hourly rate; the km rule does not apply.
        HX098Setup();
        HX098KmAllowance(5);
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B02', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-B02', 'HX98-HB', 'BL-0202');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1030, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(840, Pricing.CalcAmount(Contract), 'S2: 600 for three days plus 6 extra engine hours at 40, no km charge');
        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(840, Preview.TotalAmount(PreviewLine), 'S2: the invoice preview shows the same boat price');
    end;

    [Test]
    procedure Scenario03()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // No boat leaves the harbour without the customer's boat licence.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B03', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-B03', 'HX98-HB', '');
        asserterror RentalMgt.CheckOut(ContractNo);
    end;

    [Test]
    procedure Scenario04()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // A boat is handed out only at a harbour branch.
        HX098Setup();
        HX098Branch('HX98-CB', false);
        HX098Asset('HX98-B04', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-B04', 'HX98-CB', 'BL-0404');
        asserterror RentalMgt.CheckOut(ContractNo);
    end;

    [Test]
    procedure Scenario05()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // With a licence, at a harbour branch, the boat is handed out.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B05', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-B05', 'HX98-HB', 'BL-0505');
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'S5: the boat contract is checked out');
        Assert.AreEqual(1000, Contract."Start Km", 'S5: the start reading is the boat''s engine hours');
    end;

    [Test]
    procedure Scenario06()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // A car rental cannot be moved onto a boat.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-C06', "CGR Asset Type"::Car, 20000, 80);
        HX098Asset('HX98-B06', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-C06', 'HX98-HB', 'BL-0606');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX98-B06');
    end;

    [Test]
    procedure Scenario07()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ContractNo: Code[20];
    begin
        // A boat rental can move to another boat, and the boats change places.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B07', "CGR Asset Type"::Boat, 1000, 200);
        HX098Asset('HX98-B7X', "CGR Asset Type"::Boat, 400, 200);
        ContractNo := HX098Contract('HX98-B07', 'HX98-HB', 'BL-0707');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.SwapVehicle(ContractNo, 'HX98-B7X');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX98-B7X', Contract."Vehicle No.", 'S7: the contract moved to the other boat');
        Assert.AreEqual(400, Contract."Start Km", 'S7: the start reading is the new boat''s engine hours');
        Assert.IsTrue(FleetMgt.IsAvailable('HX98-B07'), 'S7: the first boat is free again');
        Assert.IsFalse(FleetMgt.IsAvailable('HX98-B7X'), 'S7: the new boat is out');
    end;

    [Test]
    procedure Scenario08()
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        // A boat is due for service every 100 engine hours.
        HX098Setup();
        HX098Asset('HX98-B08', "CGR Asset Type"::Boat, 636, 200);
        Vehicle.Get('HX98-B08');
        Vehicle."Last Service Km" := 537;
        Vehicle.Modify();
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('HX98-B08', 20270301D), 'S8: 99 hours after its service the boat is not due');
        Vehicle.Get('HX98-B08');
        Vehicle.Mileage := 637;
        Vehicle.Modify();
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('HX98-B08', 20270301D), 'S8: 100 hours after its service the boat is due');
    end;

    [Test]
    procedure Scenario09()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        // Cars are leased as before; boats are never leased.
        HX098Setup();
        HX098Asset('HX98-C09', "CGR Asset Type"::Car, 20000, 80);
        HX098Asset('HX98-B09', "CGR Asset Type"::Boat, 1000, 200);
        Assert.AreNotEqual('', LeaseMgt.CreateContract('HX98-C09', 'HX098 Customer', 20270301D, 12, 500), 'S9: a car is still leased');
        asserterror LeaseMgt.CreateContract('HX98-B09', 'HX098 Customer', 20270301D, 12, 500);
    end;

    [Test]
    procedure Scenario10()
    var
        Entry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // The ledger records a boat's engine hours, not km.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B10', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-B10', 'HX98-HB', 'BL-1010');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1030, '');
        RentalMgt.Post(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.IsTrue(Entry.FindFirst(), 'S10: the boat contract is posted');
        Assert.AreEqual(30, Entry."Engine Hours", 'S10: engine hours used');
        Assert.AreEqual(0, Entry."Km Driven", 'S10: a boat drives no km');
        Assert.AreEqual(840, Entry.Amount, 'S10: the posted amount');
    end;

    [Test]
    procedure Scenario11()
    var
        Entry: Record "CGR Rental Ledger Entry";
        Buffer: Record "CGR Asset Revenue Buffer";
        AssetTypeRevenue: Codeunit "CGR Asset Type Revenue";
        Total: Decimal;
    begin
        // Revenue per asset type covers boats and adds up to the ledger.
        HX098Asset('HX98-C11', "CGR Asset Type"::Car, 20000, 80);
        HX098Asset('HX98-V11', "CGR Asset Type"::Van, 30000, 120);
        HX098Asset('HX98-B11', "CGR Asset Type"::Boat, 1000, 200);
        Entry.SetRange("Posting Date", 20310301D, 20310331D);
        Entry.DeleteAll();
        HX098Ledger('HX98-C11', 20310305D, 110);
        HX098Ledger('HX98-V11', 20310310D, 50);
        HX098Ledger('HX98-B11', 20310312D, 70);
        HX098Ledger('HX98-B11', 20310320D, 30);
        AssetTypeRevenue.RevenueByAssetType(20310301D, 20310331D, Buffer);
        Buffer.Reset();
        Assert.IsTrue(Buffer.Get("CGR Asset Type"::Boat), 'S11: boats have a revenue row');
        Assert.AreEqual(100, Buffer.Amount, 'S11: boat revenue');
        Assert.AreEqual(2, Buffer."Entry Count", 'S11: boat entries');
        Assert.IsTrue(Buffer.Get("CGR Asset Type"::Car), 'S11: cars have a revenue row');
        Assert.AreEqual(110, Buffer.Amount, 'S11: car revenue');
        Assert.AreEqual(1, Buffer."Entry Count", 'S11: car entries');
        Buffer.Reset();
        if Buffer.FindSet() then
            repeat
                Total += Buffer.Amount;
            until Buffer.Next() = 0;
        Assert.AreEqual(260, Total, 'S11: revenue per asset type adds up to the ledger');
    end;

    [Test]
    procedure Scenario12()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Payload: JsonObject;
        Token: JsonToken;
        ContractNo: Code[20];
    begin
        // The partner portal hears that a boat went out.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B12', "CGR Asset Type"::Boat, 1000, 200);
        Entry.SetRange("Vehicle No.", 'HX98-B12');
        Entry.DeleteAll();
        ContractNo := HX098Contract('HX98-B12', 'HX98-HB', 'BL-1212');
        RentalMgt.CheckOut(ContractNo);
        Assert.IsTrue(Entry.FindLast(), 'S12: the checkout is queued for the portal');
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'S12: the message is JSON: ' + Entry.Payload);
        Assert.IsTrue(Payload.Get('assetType', Token), 'S12: the message names the asset type: ' + Entry.Payload);
        Assert.AreEqual('boat', Token.AsValue().AsText(), 'S12: the asset type is boat');
    end;

    [Test]
    procedure Scenario13()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // A boat rental cannot be moved onto a car.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B13', "CGR Asset Type"::Boat, 1000, 200);
        HX098Asset('HX98-C13', "CGR Asset Type"::Car, 20000, 80);
        ContractNo := HX098Contract('HX98-B13', 'HX98-HB', 'BL-1313');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX98-C13');
    end;

    [Test]
    procedure Scenario14()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // Hidden regression: a van rental cannot be moved onto a boat.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-V14', "CGR Asset Type"::Van, 30000, 120);
        HX098Asset('HX98-B14', "CGR Asset Type"::Boat, 1000, 200);
        ContractNo := HX098Contract('HX98-V14', 'HX98-HB', 'BL-1414');
        HX098LicenceClass(ContractNo, 'C');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX98-B14');
    end;

    [Test]
    procedure Scenario15()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // Hidden regression: a boat rental cannot be moved onto a van.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-B15', "CGR Asset Type"::Boat, 1000, 200);
        HX098Asset('HX98-V15', "CGR Asset Type"::Van, 30000, 120);
        ContractNo := HX098Contract('HX98-B15', 'HX98-HB', 'BL-1515');
        HX098LicenceClass(ContractNo, 'C');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX98-V15');
    end;

    [Test]
    procedure Scenario16()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        // Hidden regression: vans keep their licence check and their surcharge.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-V16', "CGR Asset Type"::Van, 30000, 80);
        ContractNo := HX098Contract('HX98-V16', 'HX98-HB', '');
        HX098LicenceClass(ContractNo, 'C');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 30100, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(315, Pricing.CalcAmount(Contract), 'S16: three van days at 80 plus the van surcharge of 25 a day');
    end;

    [Test]
    procedure Scenario17()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        // Hidden regression: a van without licence class C or CE is not handed out.
        HX098Setup();
        HX098Branch('HX98-HB', true);
        HX098Asset('HX98-V17', "CGR Asset Type"::Van, 30000, 80);
        ContractNo := HX098Contract('HX98-V17', 'HX98-HB', 'BL-1717');
        HX098LicenceClass(ContractNo, 'B');
        asserterror RentalMgt.CheckOut(ContractNo);
    end;

    local procedure HX098LicenceClass(ContractNo: Code[20]; LicenceClass: Code[10])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Contract."Driving Licence Class" := LicenceClass;
        Contract.Modify();
    end;

    local procedure HX098WeekendSurcharge(SurchargePct: Decimal)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.Get();
        Setup."Weekend Surcharge %" := SurchargePct;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX098KmAllowance(KmPerDay: Integer)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.Get();
        Setup."Km Allowance per Day" := KmPerDay;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX098Setup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 100;
        Setup."Excess Km Rate" := 0.5;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Van Surcharge per Day" := 25;
        Setup."Engine Hour Allowance per Day" := 8;
        Setup."Excess Engine Hour Rate" := 40;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX098Branch(BranchCode: Code[10]; IsHarbour: Boolean)
    var
        Branch: Record "CGR Branch";
    begin
        if Branch.Get(BranchCode) then
            Branch.Delete();
        Branch.Init();
        Branch.Code := BranchCode;
        Branch.Name := 'HX098 branch';
        Branch.Harbour := IsHarbour;
        Branch.Insert();
    end;

    local procedure HX098Asset(VehicleNo: Code[20]; AssetType: Enum "CGR Asset Type"; Meter: Integer; DailyRate: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Rental Ledger Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Validate("Asset Type", AssetType);
        Vehicle.Mileage := Meter;
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Insert(true);
    end;

    local procedure HX098Contract(VehicleNo: Code[20]; BranchCode: Code[10]; BoatLicenceNo: Code[20]): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX098 Customer', 20270301D, 20270303D);
        Contract.Get(ContractNo);
        Contract."Branch Code" := BranchCode;
        Contract."Boat Licence No." := BoatLicenceNo;
        Contract.Modify();
        exit(ContractNo);
    end;

    local procedure HX098Ledger(VehicleNo: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        Entry: Record "CGR Rental Ledger Entry";
    begin
        Entry.Init();
        Entry."Vehicle No." := VehicleNo;
        Entry."Posting Date" := PostingDate;
        Entry.Amount := Amount;
        Entry.Insert();
    end;
}
