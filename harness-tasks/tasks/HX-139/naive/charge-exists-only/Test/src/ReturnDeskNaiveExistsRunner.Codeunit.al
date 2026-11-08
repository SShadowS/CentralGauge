codeunit 80474 "CGR Return Desk Exists Runner"
{
    var
        ExistsContractNo: Code[20];
        ExistsReturnKm: Integer;

    trigger OnRun()
    var
        ReturnDesk: Codeunit "CGR Return Desk";
    begin
        ReturnDesk.BookReturn(ExistsContractNo, ExistsReturnKm);
    end;

    procedure SetExistsRun(ContractNo: Code[20]; ReturnKm: Integer)
    begin
        ExistsContractNo := ContractNo;
        ExistsReturnKm := ReturnKm;
    end;
}
