codeunit 71322 "CG X148 Agreement Distributor"
{
    procedure DistributeToZones(AgreementNo: Code[20]; ZoneCodes: List of [Code[10]])
    var
        Agreement: Record "CG X148 Volume Agreement";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        ZoneCode: Code[10];
    begin
        if not Agreement.Get(AgreementNo) then
            exit;

        foreach ZoneCode in ZoneCodes do begin
            AgreementLine.Init();
            AgreementLine."Agreement No." := Agreement."No.";
            AgreementLine."Zone Code" := ZoneCode;
            AgreementLine."Customer No." := Agreement."Customer No.";
            AgreementLine."Currency Code" := Agreement."Currency Code";
            AgreementLine."Effective Date" := Agreement."Effective Date";
            AgreementLine.Notes := Agreement.Notes;
            AgreementLine."Rebate Group" := Agreement."Rebate Group";
            AgreementLine.Insert();
        end;
    end;
}
