codeunit 86822 "HX068 Close Runner"
{
    var
        HX068Filter: Record "CGR Rental Contract";
        HX068Posted: Integer;

    trigger OnRun()
    var
        Contract: Record "CGR Rental Contract";
        DayClose: Codeunit "CGR Desk Day Close";
    begin
        HX068Posted := -1;
        Contract.CopyFilters(HX068Filter);
        HX068Posted := DayClose.CloseDeskDay(Contract);
    end;

    procedure HX068SetFilter(var ContractFilter: Record "CGR Rental Contract")
    begin
        HX068Filter.CopyFilters(ContractFilter);
    end;

    procedure HX068LastPosted(): Integer
    begin
        exit(HX068Posted);
    end;
}
