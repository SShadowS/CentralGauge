codeunit 71371 "CG X153 Technician Directory"
{
    procedure GetTechnicianCodes(SiteCode: Code[20]; var TechnicianCodes: List of [Code[20]])
    var
        ServiceCall: Record "CG X153 Service Call";
    begin
        Clear(TechnicianCodes);
        ServiceCall.SetRange("Site Code", SiteCode);
        if ServiceCall.FindSet() then
            repeat
                if ServiceCall."Technician Code" <> '' then
                    if not TechnicianCodes.Contains(ServiceCall."Technician Code") then
                        TechnicianCodes.Add(ServiceCall."Technician Code");
            until ServiceCall.Next() = 0;
        SortAscending(TechnicianCodes);
    end;

    local procedure SortAscending(var TechnicianCodes: List of [Code[20]])
    var
        Sorted: List of [Code[20]];
        SmallestCode: Code[20];
        CurrentCode: Code[20];
        HaveSmallest: Boolean;
        TotalCount: Integer;
        i: Integer;
    begin
        TotalCount := TechnicianCodes.Count();
        while Sorted.Count() < TotalCount do begin
            HaveSmallest := false;
            for i := 1 to TechnicianCodes.Count() do begin
                CurrentCode := TechnicianCodes.Get(i);
                if not Sorted.Contains(CurrentCode) then
                    if (not HaveSmallest) or (CurrentCode < SmallestCode) then begin
                        SmallestCode := CurrentCode;
                        HaveSmallest := true;
                    end;
            end;
            Sorted.Add(SmallestCode);
        end;
        TechnicianCodes := Sorted;
    end;
}
