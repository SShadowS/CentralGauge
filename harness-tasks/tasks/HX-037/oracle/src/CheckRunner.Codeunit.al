codeunit 86202 "HX037 Check Runner"
{
    var
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
        FirstResult: Boolean;
        SecondResult: Boolean;
        Problems: List of [Text];

    procedure SetContracts(NewFirstContractNo: Code[20]; NewSecondContractNo: Code[20])
    begin
        FirstContractNo := NewFirstContractNo;
        SecondContractNo := NewSecondContractNo;
        FirstResult := true;
        SecondResult := false;
        Clear(Problems);
    end;

    procedure GetFirstResult(): Boolean
    begin
        exit(FirstResult);
    end;

    procedure GetSecondResult(): Boolean
    begin
        exit(SecondResult);
    end;

    procedure ProblemCount(): Integer
    begin
        exit(Problems.Count());
    end;

    procedure ProblemAt(Index: Integer): Text
    begin
        exit(Problems.Get(Index));
    end;

    trigger OnRun()
    var
        ContractCheck: Codeunit "CGR Contract Check";
    begin
        FirstResult := ContractCheck.CheckForPosting(FirstContractNo, Problems);
        if SecondContractNo <> '' then
            SecondResult := ContractCheck.CheckForPosting(SecondContractNo, Problems);
    end;
}
