codeunit 71324 "CG X148 Rebate Resolver"
{
    procedure GetRebatePct(AgreementLine: Record "CG X148 Volume Agreement Line"): Decimal
    var
        RebateRate: Record "CG X148 Rebate Rate";
    begin
        if AgreementLine."Rebate Group" = '' then
            exit(StandardRebatePct());
        if not RebateRate.Get(AgreementLine."Rebate Group") then
            exit(StandardRebatePct());
        exit(RebateRate."Rebate %");
    end;

    local procedure StandardRebatePct(): Decimal
    begin
        exit(2.5);
    end;
}
