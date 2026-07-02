table 69930 "CG X041 Doc"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Batch Id"; Integer) { }
        field(2; "Line No."; Integer) { }
        field(3; Status; Option)
        {
            OptionMembers = Open,Posted;
        }
        field(4; "Amount"; Integer) { }
    }
    keys
    {
        key(PK; "Batch Id", "Line No.") { Clustered = true; }
    }

    // Protective trigger: a posted line is durable and must never be quietly
    // deleted. Whether this fires at all depends entirely on how the caller
    // deletes the row.
    trigger OnDelete()
    begin
        if Status = Status::Posted then
            Error('CG X041 Doc: a posted line cannot be deleted');
    end;
}
