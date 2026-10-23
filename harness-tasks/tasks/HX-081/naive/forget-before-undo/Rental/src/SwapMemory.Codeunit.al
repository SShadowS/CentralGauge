codeunit 70234 "CGR Swap Memory"
{
    SingleInstance = true;

    var
        LastContractNo: Code[20];
        LastFromVehicleNo: Code[20];

    procedure RememberSwap(ContractNo: Code[20]; FromVehicleNo: Code[20])
    begin
        LastContractNo := ContractNo;
        LastFromVehicleNo := FromVehicleNo;
    end;

    procedure RecallSwap(var ContractNo: Code[20]; var FromVehicleNo: Code[20]): Boolean
    begin
        ContractNo := LastContractNo;
        FromVehicleNo := LastFromVehicleNo;
        exit(LastContractNo <> '');
    end;

    procedure ForgetSwap()
    begin
        Clear(LastContractNo);
        Clear(LastFromVehicleNo);
    end;
}
