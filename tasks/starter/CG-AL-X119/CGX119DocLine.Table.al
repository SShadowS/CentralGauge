table 70791 "CG X119 Doc Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Line Type"; Enum "CG X119 Line Type") { }
        field(4; "No."; Code[20]) { }
    }

    keys
    {
        key(PK; "Document No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
