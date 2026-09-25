table 70300 "CGR Lease Contract"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Vehicle No."; Code[20])
        {
            trigger OnValidate()
            var
                Line: Record "CGR Lease Schedule Line";
            begin
                Line.SetRange("Contract No.", "No.");
                Line.ModifyAll("Vehicle No.", "Vehicle No.");
            end;
        }
        field(3; "Customer Name"; Text[100]) { }
        field(4; "Start Date"; Date) { }
        field(5; Months; Integer) { }
        field(6; "Base Rate"; Decimal) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
