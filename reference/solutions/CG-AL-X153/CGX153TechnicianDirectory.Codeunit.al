codeunit 71371 "CG X153 Technician Directory"
{
    procedure GetTechnicianCodes(SiteCode: Code[20]; var TechnicianCodes: List of [Code[20]])
    var
        ServiceCall: Record "CG X153 Service Call";
        LastCode: Code[20];
    begin
        Clear(TechnicianCodes);
        LastCode := '';
        ServiceCall.SetCurrentKey("Site Code", "Technician Code");
        ServiceCall.SetRange("Site Code", SiteCode);
        ServiceCall.SetFilter("Technician Code", '>%1', LastCode);
        while ServiceCall.FindFirst() do begin
            LastCode := ServiceCall."Technician Code";
            TechnicianCodes.Add(LastCode);
            ServiceCall.SetFilter("Technician Code", '>%1', LastCode);
        end;
    end;
}
