table 70130 "CGR Repair Estimate Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; "Line No."; Integer) { }
        field(4; Description; Text[50]) { }
        field(5; Amount; Decimal) { }
        field(6; "Created On"; Date) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }

    trigger OnInsert()
    begin
        "Created On" := WorkDate();
    end;
}
