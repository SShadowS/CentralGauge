codeunit 80472 "CGR Return Desk Shown Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        ShownCount: Integer;

    [Test]
    procedure ScannerReturnChargesExcess()
    var
        Charge: Record "CGR Return Excess Charge";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        ShownPrepare();
        ContractNo := ShownContract('HX139-NS1');

        ReturnDesk.BookReturn(ContractNo, 1450);

        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Charge.Count(), 'One charge row');
        Charge.FindFirst();
        Assert.AreEqual(150, Charge."Excess Km", 'Excess km');
        Assert.AreEqual(52.5, Charge.Amount, 'Charge amount');
    end;

    [Test]
    procedure AtAllowanceNoCharge()
    var
        Charge: Record "CGR Return Excess Charge";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        ShownPrepare();
        ContractNo := ShownContract('HX139-NS2');

        ReturnDesk.BookReturn(ContractNo, 1300);

        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Charge.Count(), 'No charge at the allowance');
    end;

    [Test]
    [HandlerFunctions('ShownMessageHandler')]
    procedure DamagedVehicleShowsWarning()
    var
        Damage: Record "CGR Damage Entry";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
        Index: Integer;
    begin
        ShownPrepare();
        ShownCount := 0;
        Lib.CreateVehicle('HX139-NS3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        for Index := 1 to 2 do begin
            Damage.Init();
            Damage."Entry No." := 0;
            Damage."Vehicle No." := 'HX139-NS3';
            Damage.Description := 'Dent';
            Damage.Insert();
        end;
        ContractNo := ShownContractFor('HX139-NS3');

        ReturnDesk.BookReturn(ContractNo, 1100);

        Assert.AreEqual(1, ShownCount, 'The open-damages warning is shown');
    end;

    [MessageHandler]
    procedure ShownMessageHandler(Message: Text[1024])
    begin
        ShownCount += 1;
    end;

    local procedure ShownPrepare()
    begin
        WorkDate(20250415D);
        Lib.SetPricing(0, 100, 0.35);
    end;

    local procedure ShownContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(ShownContractFor(VehicleNo));
    end;

    local procedure ShownContractFor(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Naive Customer', 20250407D, 20250409D);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;
}
