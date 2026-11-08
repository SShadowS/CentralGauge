codeunit 80475 "CGR Return Desk Headless Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        HeadlessText: Text;

    [Test]
    procedure ReturnStoresReturnKm()
    var
        Contract: Record "CGR Rental Contract";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        HeadlessPrepare();
        ContractNo := HeadlessContract('HX139-NH1');

        ReturnDesk.BookReturn(ContractNo, 1450);

        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract returned');
        Assert.AreEqual(1450, Contract."Return Km", 'Return km stored');
    end;

    [Test]
    procedure ExactAllowanceIsFree()
    var
        Charge: Record "CGR Return Excess Charge";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        HeadlessPrepare();
        ContractNo := HeadlessContract('HX139-NH2');

        ReturnDesk.BookReturn(ContractNo, 1300);

        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Charge.Count(), 'Nothing charged at the allowance');
    end;

    [Test]
    [HandlerFunctions('HeadlessMessageHandler')]
    procedure DamageWarningText()
    var
        Damage: Record "CGR Damage Entry";
        ReturnDesk: Codeunit "CGR Return Desk";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        HeadlessPrepare();
        HeadlessText := '';
        Lib.CreateVehicle('HX139-NH3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Damage.Init();
        Damage."Vehicle No." := 'HX139-NH3';
        Damage.Insert();
        Damage.Init();
        Damage."Entry No." := 0;
        Damage."Vehicle No." := 'HX139-NH3';
        Damage.Repaired := true;
        Damage.Insert();
        ContractNo := RentalMgt.CreateContract('HX139-NH3', 'Naive Customer', 20250407D, 20250409D);
        RentalMgt.CheckOut(ContractNo);

        ReturnDesk.BookReturn(ContractNo, 1100);

        Assert.AreEqual('Vehicle HX139-NH3 has 1 open damages. Inspect it before it is rented again.', HeadlessText, 'Open damages message');
    end;

    [MessageHandler]
    procedure HeadlessMessageHandler(Message: Text[1024])
    begin
        HeadlessText := Message;
    end;

    local procedure HeadlessPrepare()
    begin
        WorkDate(20250415D);
        Lib.SetPricing(0, 100, 0.35);
    end;

    local procedure HeadlessContract(VehicleNo: Code[20]): Code[20]
    var
        Charge: Record "CGR Return Excess Charge";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Naive Customer', 20250407D, 20250409D);
        RentalMgt.CheckOut(ContractNo);
        Charge.SetRange("Contract No.", ContractNo);
        Charge.DeleteAll();
        exit(ContractNo);
    end;
}
